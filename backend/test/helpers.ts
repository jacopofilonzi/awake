import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, type RunningServer } from "../src/app.ts";
import { defaultTiming, type Config, type Timing } from "../src/config.ts";
import { setLogLevel } from "../src/log.ts";

setLogLevel("silent");

export const fastTiming: Timing = {
  ...defaultTiming,
  heartbeatSec: 1,
  agentIdleMs: 5_000,
  helloTimeoutMs: 300,
  ackTimeoutMs: 300,
  probeTimeoutMs: 100,
  probeResultTimeoutMs: 300,
  statusCacheMs: 200,
  probeIntervalMs: 40,
  wakeWindowMs: 600,
};

export const NEW_PASSWORD = "correct horse battery";

export interface TestServer extends RunningServer {
  url: string;
  wsUrl: string;
  config: Config;
  /** A logged-in client for `admin`, password already changed. */
  admin: Client;
}

export async function startTestServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awake-test-"));
  // Port 0: the real port is only known after listening; PUBLIC_URL is fixed below.
  const config: Config = {
    port: 0,
    publicUrl: "http://localhost",
    dataDir,
    trustProxy: false,
    registration: { enabled: false, autoApprove: false },
    providers: [],
    sessionTtlMs: 86_400_000,
    passwordLinkTtlMs: 3_600_000,
    timing: fastTiming,
    ...overrides,
  };
  const server = await startServer(config);
  const url = `http://127.0.0.1:${server.port}`;
  const s: TestServer = {
    ...server,
    url,
    wsUrl: `ws://127.0.0.1:${server.port}/agent`,
    config,
    admin: null as unknown as Client,
    close: async () => {
      await server.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  s.admin = new Client(s);
  await s.admin.login("admin", server.bootstrapPassword!);
  await s.admin.req("POST", "/auth/password", { currentPassword: server.bootstrapPassword, newPassword: NEW_PASSWORD });
  return s;
}

/** An HTTP client with its own cookie jar, like one browser. */
export class Client {
  cookies = new Map<string, string>();

  constructor(private s: { url: string }) {}

  async req<T = any>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const res = await fetch(this.s.url + "/api" + p, {
      method,
      redirect: "manual",
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair!.split("=");
      if (/max-age=0/i.test(c) || v === "") this.cookies.delete(k!);
      else this.cookies.set(k!, v!);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async login(username: string, password: string) {
    const res = await this.req("POST", "/auth/login", { username, password });
    if (res.status !== 200) throw new Error(`login ${username}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
}

/** Creates an active user (through the admin API) and returns a logged-in client for it. */
export async function createUser(s: TestServer, username: string): Promise<Client & { id: string }> {
  const res = await s.admin.req("POST", "/admin/users", { username, credentials: { type: "password", password: "temporary-pass" } });
  if (res.status !== 201) throw new Error(`create user: ${res.status} ${JSON.stringify(res.body)}`);
  const client = new Client(s) as Client & { id: string };
  client.id = res.body.user.id;
  await client.login(username, "temporary-pass");
  await client.req("POST", "/auth/password", { currentPassword: "temporary-pass", newPassword: NEW_PASSWORD });
  return client;
}

// ---------- fake agent ----------

export type FakeOutput = { id: string; mode: "button"; long?: boolean } | { id: string; mode: "switch"; on: boolean };

export interface FakeAgentOptions {
  outputs?: FakeOutput[];
  /** Answer to each probe (default: down). */
  probe?: (ip: string, port: number | undefined) => boolean;
  /** Override the reply to a command; return null to stay silent (timeout). */
  reply?: (msg: any) => object | null | undefined;
}

/** Speaks docs/PROTOCOL.md like a real agent, recording every command it receives. */
export class FakeAgent {
  received: any[] = [];
  closeCode: number | null = null;
  private ws!: WebSocket;
  switches = new Map<string, boolean>();

  constructor(
    private s: TestServer,
    readonly token: string,
    private opts: FakeAgentOptions = {},
  ) {
    for (const o of opts.outputs ?? []) if (o.mode === "switch") this.switches.set(o.id, o.on);
  }

  /** Connects and resolves on welcome (or rejects with the close code). */
  connect(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.s.wsUrl);
      this.ws.addEventListener("open", () => {
        const outputs = (this.opts.outputs ?? []).map((o) => (o.mode === "switch" ? { ...o, on: this.switches.get(o.id) } : o));
        this.send({ t: "hello", v: 1, token: this.token, fw: "fake/1", outputs });
      });
      this.ws.addEventListener("message", (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.t === "welcome") return resolve(msg);
        if (msg.t === "hb") return;
        this.received.push(msg);
        this.handle(msg);
      });
      this.ws.addEventListener("close", (e) => {
        this.closeCode = e.code;
        reject(new Error(`closed ${e.code}`));
      });
    });
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** A local (physical) change of a switch. */
  toggleLocally(id: string, on: boolean): void {
    this.switches.set(id, on);
    this.send({ t: "out_state", out: id, on });
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.addEventListener("close", () => resolve());
      this.ws.close(1000);
    });
  }

  private handle(msg: any): void {
    const custom = this.opts.reply?.(msg);
    if (custom === null) return;
    if (custom) return this.send({ id: msg.id, ...custom });
    switch (msg.t) {
      case "wake":
        return this.send({ t: "ack", id: msg.id, ok: true });
      case "probe":
        return this.send({ t: "probe_result", id: msg.id, up: this.opts.probe?.(msg.ip, msg.port) ?? false });
      case "press":
        return this.send({ t: "ack", id: msg.id, ok: true });
      case "set":
        this.switches.set(msg.out, msg.on);
        return this.send({ t: "ack", id: msg.id, ok: true, on: msg.on });
    }
  }
}

/** Opens a raw WebSocket, sends one message and resolves with the close code. */
export function rawAgent(s: TestServer, first: unknown): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(s.wsUrl);
    ws.addEventListener("open", () => ws.send(typeof first === "string" ? first : JSON.stringify(first)));
    ws.addEventListener("close", (e) => resolve(e.code));
  });
}

export async function waitFor<T>(fn: () => Promise<T> | T, until: (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (until(value)) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out, last value: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Creates a house and an agent in it; returns their ids and the agent token. */
export async function houseWithAgent(client: Client, agentName = "agent-1") {
  const house = await client.req("POST", "/houses", { name: "Home" });
  const agent = await client.req("POST", `/houses/${house.body.id}/agents`, { name: agentName });
  return { houseId: house.body.id as string, agentId: agent.body.agent.id as string, token: agent.body.token as string };
}
