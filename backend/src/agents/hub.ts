// WebSocket gateway for agents: authentication, presence, commands and their replies.
// Protocol: docs/PROTOCOL.md. The hub only speaks the protocol; what an event means for devices
// (state, logs, live updates) is decided by the HubListener (the device service).

import crypto from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION } from "@awake/shared";
import type { Timing } from "../config.ts";
import type { Db } from "../db.ts";
import { log } from "../log.ts";
import type { RateLimiter } from "../ratelimit.ts";
import { hashToken } from "../secrets.ts";
import {
  CloseCode,
  MAX_MESSAGE_BYTES,
  parseMessage,
  parseOutputs,
  type AgentToServer,
  type HelloOutput,
  type ServerToAgent,
} from "./protocol.ts";

export interface HubListener {
  /** After a successful hello, with the outputs it declared. */
  agentConnected(agentId: string, outputs: HelloOutput[]): void;
  agentDisconnected(agentId: string): void;
  /** A switch changed on the agent's side (out_state). */
  outputChanged(agentId: string, outputId: string, on: boolean): void;
}

/** Outcome of a command sent to one agent. */
export interface CommandResult {
  status: "ok" | "offline" | "timeout" | "error";
  err?: string;
  /** For `set`: the switch state reported in the ack. */
  on?: boolean;
}

export type ProbeOutcome = "up" | "down" | "error";

type Reply = Extract<AgentToServer, { t: "ack" } | { t: "probe_result" }>;

interface AgentConn {
  ws: WebSocket;
  agentId: string;
  name: string;
  lastActivity: number;
  pending: Map<string, { expects: Reply["t"]; resolve: (msg: Reply | null) => void }>;
}

export class AgentHub {
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private conns = new Map<string, AgentConn>();
  private idleTimer: NodeJS.Timeout;
  private closed = false;
  private listener: HubListener | null = null;

  constructor(
    private db: Db,
    private timing: Timing,
    private limiter: RateLimiter,
  ) {
    // Drop silent connections (Wi-Fi lost without a FIN, etc.).
    this.idleTimer = setInterval(
      () => {
        const now = Date.now();
        for (const conn of this.conns.values()) {
          if (now - conn.lastActivity > timing.agentIdleMs) conn.ws.terminate();
        }
      },
      Math.min(10_000, timing.agentIdleMs / 2),
    );
    this.idleTimer.unref();
  }

  setListener(listener: HubListener): void {
    this.listener = listener;
  }

  isOnline(agentId: string): boolean {
    return this.conns.has(agentId);
  }

  /** Closes the agent's connection (token regenerated, agent or house deleted). */
  disconnect(agentId: string): void {
    this.conns.get(agentId)?.ws.close(CloseCode.Revoked, "revoked");
  }

  close(): void {
    this.closed = true;
    clearInterval(this.idleTimer);
    for (const ws of this.wss.clients) ws.close(CloseCode.ServerShutdown, "server shutdown");
  }

  async wake(agentId: string, mac: string): Promise<CommandResult> {
    return ackResult(await this.request(agentId, "ack", this.timing.ackTimeoutMs, (id) => ({ t: "wake", id, mac })));
  }

  async press(agentId: string, out: string, long: boolean): Promise<CommandResult> {
    return ackResult(
      await this.request(agentId, "ack", this.timing.ackTimeoutMs, (id) => ({ t: "press", id, out, ...(long ? { long: true } : {}) })),
    );
  }

  async set(agentId: string, out: string, on: boolean): Promise<CommandResult> {
    return ackResult(await this.request(agentId, "ack", this.timing.ackTimeoutMs, (id) => ({ t: "set", id, out, on })));
  }

  /** Asks an agent whether a host is up (ICMP, or TCP connect when port is set). */
  async probe(agentId: string, ip: string, port: number | null): Promise<ProbeOutcome> {
    const reply = await this.request(agentId, "probe_result", this.timing.probeResultTimeoutMs, (id) => ({
      t: "probe",
      id,
      ip,
      ...(port ? { port } : {}),
      timeout: this.timing.probeTimeoutMs,
    }));
    if (typeof reply === "object" && reply?.t === "probe_result") return reply.err ? "error" : reply.up === true ? "up" : "down";
    return "error";
  }

  handleConnection(ws: WebSocket, ip: string): void {
    if (this.limiter.isBlocked(ip)) {
      ws.close(CloseCode.RateLimited, "too many attempts");
      return;
    }

    let conn: AgentConn | null = null;
    const helloTimer = setTimeout(() => ws.close(CloseCode.HelloTimeout, "hello timeout"), this.timing.helloTimeoutMs);

    ws.on("message", (data, isBinary) => {
      if (this.closed) return; // shutting down: the database may already be closed
      const msg = isBinary ? null : parseMessage(data.toString());
      if (!msg) {
        ws.close(CloseCode.ProtocolError, "invalid message");
        return;
      }

      if (!conn) {
        conn = this.authenticate(ws, ip, msg);
        if (conn) clearTimeout(helloTimer);
        return;
      }

      conn.lastActivity = Date.now();
      switch (msg.t) {
        case "hb":
          this.db.prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(conn.lastActivity, conn.agentId);
          send(ws, { t: "hb" });
          break;
        case "ack":
        case "probe_result": {
          if (typeof msg.id !== "string") break;
          const pending = conn.pending.get(msg.id);
          if (pending?.expects === msg.t) {
            conn.pending.delete(msg.id);
            pending.resolve(msg);
          }
          break;
        }
        case "out_state":
          if (typeof msg.out === "string" && typeof msg.on === "boolean") {
            this.listener?.outputChanged(conn.agentId, msg.out, msg.on);
          }
          break;
        // Unknown message types are ignored for forward compatibility.
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (!conn) return;
      for (const pending of conn.pending.values()) pending.resolve(null);
      conn.pending.clear();
      if (this.conns.get(conn.agentId) !== conn) return; // replaced by a newer connection
      this.conns.delete(conn.agentId);
      if (this.closed) return; // database may already be closed
      this.db.prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(Date.now(), conn.agentId);
      log.info("agent", "disconnected", { name: conn.name, id: conn.agentId });
      this.listener?.agentDisconnected(conn.agentId);
    });

    ws.on("error", () => ws.terminate());
  }

  private authenticate(ws: WebSocket, ip: string, msg: AgentToServer): AgentConn | null {
    if (msg.t !== "hello" || typeof msg.token !== "string") {
      ws.close(CloseCode.ProtocolError, "expected hello");
      return null;
    }
    if (msg.v !== PROTOCOL_VERSION) {
      ws.close(CloseCode.UnsupportedVersion, `supported version: ${PROTOCOL_VERSION}`);
      return null;
    }
    const outputs = parseOutputs(msg.outputs);
    if (!outputs) {
      ws.close(CloseCode.ProtocolError, "invalid outputs");
      return null;
    }
    const row = this.db.prepare("SELECT id, name FROM agents WHERE token_hash = ?").get(hashToken(msg.token)) as
      | { id: string; name: string }
      | undefined;
    if (!row) {
      this.limiter.recordFailure(ip);
      ws.close(CloseCode.AuthFailed, "invalid token");
      return null;
    }

    // One connection per agent: the newest one wins. Its close handler sees it was replaced and
    // does not report a disconnection.
    const previous = this.conns.get(row.id);
    const conn: AgentConn = { ws, agentId: row.id, name: row.name, lastActivity: Date.now(), pending: new Map() };
    this.conns.set(row.id, conn);
    previous?.ws.close(CloseCode.Replaced, "replaced by a new connection");

    const fw = typeof msg.fw === "string" ? msg.fw.slice(0, 64) : null;
    this.db.prepare("UPDATE agents SET firmware = ?, last_seen = ? WHERE id = ?").run(fw, Date.now(), row.id);
    send(ws, { t: "welcome", v: PROTOCOL_VERSION, name: row.name, hb: this.timing.heartbeatSec });
    log.info("agent", "connected", { name: row.name, id: row.id, ip, fw: fw ?? undefined, outputs: outputs.length });
    this.listener?.agentConnected(row.id, outputs);
    return conn;
  }

  private request(
    agentId: string,
    expects: Reply["t"],
    timeoutMs: number,
    build: (id: string) => ServerToAgent,
  ): Promise<Reply | null | "offline" | "timeout"> {
    const conn = this.conns.get(agentId);
    if (!conn) return Promise.resolve("offline");

    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        resolve("timeout");
      }, timeoutMs);
      conn.pending.set(id, {
        expects,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
      send(conn.ws, build(id));
    });
  }
}

function ackResult(reply: Reply | null | "offline" | "timeout"): CommandResult {
  if (reply === "offline" || reply === "timeout") return { status: reply };
  // null: the connection dropped while waiting.
  if (reply?.t !== "ack") return { status: "error", err: "disconnected" };
  const on = typeof reply.on === "boolean" ? reply.on : undefined;
  if (reply.ok === true) return { status: "ok", on };
  const err = typeof reply.err === "string" ? reply.err.slice(0, 64) : undefined;
  return { status: "error", err, on };
}

function send(ws: WebSocket, msg: ServerToAgent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
