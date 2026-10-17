import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import { parseInfo } from "../src/agents/protocol.ts";
import { startServer } from "../src/app.ts";
import { Client, createUser, FakeAgent, fastTiming, houseWithAgent, NEW_PASSWORD, startTestServer, waitFor, type TestServer } from "./helpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function agentOf(client: Client, houseId: string, agentId: string): Promise<any> {
  const res = await client.req("GET", `/houses/${houseId}/agents`);
  assert.equal(res.status, 200);
  return res.body.find((a: any) => a.id === agentId);
}

describe("parseInfo", () => {
  test("keeps valid fields, drops invalid ones one by one", () => {
    assert.deepEqual(
      parseInfo({
        t: "info",
        platform: " linux/arm64 ",
        host: "h".repeat(65),
        ip: "192.168.1.300",
        ssid: "Casa",
        rssi: -61.5,
        uptime: 86400,
        reset: "watchdog",
        mem: -1,
        extra: true,
      }),
      { platform: "linux/arm64", ssid: "Casa", uptime: 86400, reset: "watchdog" },
    );
    assert.deepEqual(parseInfo({ ip: "10.0.0.2", rssi: 0, mem: 0 }), { ip: "10.0.0.2", rssi: 0, mem: 0 });
    assert.equal(parseInfo({ rssi: 5, reset: "cosmic ray", ssid: "" }), null);
    assert.equal(parseInfo(null), null);
    assert.equal(parseInfo([{ rssi: -50 }]), null);
    assert.equal(parseInfo("info"), null);
  });
});

describe("agent details", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("info from hello and info messages, rate limited, invalid fields dropped", async () => {
    const { houseId, agentId, token } = await houseWithAgent(s.admin);
    const before = await agentOf(s.admin, houseId, agentId);
    assert.deepEqual(before.details, {
      info: null,
      infoAt: null,
      connection: { since: null, ip: null, connections24h: 0, lastClose: null },
      stats: { commands24h: 0, failed24h: 0, lastCommandAt: null },
    });

    const agent = new FakeAgent(s, token, { info: { platform: "linux/arm64", rssi: -61, uptime: 10, host: 42, reset: "nope" } });
    const connectedAt = Date.now();
    await agent.connect();
    let a = await agentOf(s.admin, houseId, agentId);
    assert.deepEqual(a.details.info, { platform: "linux/arm64", rssi: -61, uptime: 10 });
    assert.ok(a.details.infoAt >= connectedAt);
    assert.ok(a.details.connection.since >= connectedAt);
    assert.match(a.details.connection.ip, /127\.0\.0\.1/);
    assert.equal(a.details.connection.connections24h, 1);

    // Too soon after hello: ignored.
    agent.sendInfo({ rssi: -40 });
    await sleep(50);
    assert.equal((await agentOf(s.admin, houseId, agentId)).details.info.rssi, -61);

    // After the interval: replaces the previous info (missing fields are unknown, not unchanged).
    await sleep(fastTiming.infoMinIntervalMs);
    agent.sendInfo({ rssi: -70, mem: 18200 });
    a = await waitFor(
      () => agentOf(s.admin, houseId, agentId),
      (x) => x.details.info?.rssi === -70,
    );
    assert.deepEqual(a.details.info, { rssi: -70, mem: 18200 });
    const infoAt = a.details.infoAt;

    // Within the interval of the last accepted one: ignored.
    agent.sendInfo({ rssi: -80 });
    await sleep(50);
    assert.deepEqual((await agentOf(s.admin, houseId, agentId)).details, a.details);

    // Nothing valid, and the connection stays open: info never closes it.
    await sleep(fastTiming.infoMinIntervalMs);
    agent.sendInfo({ rssi: "strong", reset: 3 });
    await sleep(50);
    a = await agentOf(s.admin, houseId, agentId);
    assert.deepEqual(a.details.info, { rssi: -70, mem: 18200 });
    assert.equal(a.details.infoAt, infoAt);
    assert.equal(agent.isOpen, true);
    assert.equal(a.online, true);

    // A hello without info (older firmware) keeps the last known info.
    await agent.close();
    const old = new FakeAgent(s, token);
    await old.connect();
    a = await agentOf(s.admin, houseId, agentId);
    assert.deepEqual(a.details.info, { rssi: -70, mem: 18200 });
    await old.close();
  });

  test("an info message tells the house's UIs to refetch the agents", async () => {
    const owner = await createUser(s, "watcher");
    const { houseId, agentId, token } = await houseWithAgent(owner);
    const agent = new FakeAgent(s, token);
    await agent.connect();

    const ac = new AbortController();
    const res = await fetch(`${s.url}/api/events`, {
      headers: { cookie: [...owner.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        text += new TextDecoder().decode(value);
      }
    };
    await readUntil("event: ready");
    await sleep(fastTiming.infoMinIntervalMs);
    agent.sendInfo({ uptime: 5 });
    await readUntil("event: agent");
    const line = text.split("\n").find((l) => l.startsWith("data:") && l.includes(agentId))!;
    assert.deepEqual(JSON.parse(line.slice(5)), { type: "agent", id: agentId, houseId, online: true });
    ac.abort();
    await agent.close();
  });

  test("only owners and editors see details", async () => {
    const owner = await createUser(s, "d-owner");
    const editor = await createUser(s, "d-editor");
    const member = await createUser(s, "d-member");
    const { houseId, agentId, token } = await houseWithAgent(owner);
    await owner.req("POST", `/houses/${houseId}/members`, { username: "d-editor", role: "editor" });
    await owner.req("POST", `/houses/${houseId}/members`, { username: "d-member", role: "member" });
    const agent = new FakeAgent(s, token, { info: { ssid: "Casa" } });
    await agent.connect();
    assert.equal((await agentOf(owner, houseId, agentId)).details.info.ssid, "Casa");
    assert.equal((await agentOf(editor, houseId, agentId)).details.info.ssid, "Casa");
    const seen = await agentOf(member, houseId, agentId);
    assert.equal(seen.online, true);
    assert.equal(seen.details, null);
    const renamed = await editor.req("PATCH", `/agents/${agentId}`, { name: "renamed" });
    assert.equal(renamed.body.details.info.ssid, "Casa");
    await agent.close();
  });

  test("connections: since, count, last close and its code", async () => {
    const { houseId, agentId, token } = await houseWithAgent(s.admin);
    const first = new FakeAgent(s, token);
    await first.connect();
    await first.close();
    let a = await waitFor(
      () => agentOf(s.admin, houseId, agentId),
      (x) => x.online === false,
    );
    assert.equal(a.details.connection.since, null);
    assert.equal(a.details.connection.connections24h, 1);
    assert.equal(a.details.connection.lastClose.code, 1000);
    assert.match(a.details.connection.ip, /127\.0\.0\.1/);

    // Replaced: the code the server used is recorded.
    const second = new FakeAgent(s, token);
    await second.connect();
    const third = new FakeAgent(s, token);
    await third.connect();
    await waitFor(
      () => second.closeCode,
      (c) => c === 4002,
    );
    a = await waitFor(
      () => agentOf(s.admin, houseId, agentId),
      (x) => x.details.connection.lastClose?.code === 4002,
    );
    assert.equal(a.online, true);
    assert.equal(a.details.connection.connections24h, 3);
    assert.ok(a.details.connection.since >= a.details.connection.lastClose.at - 1000);

    // Revoked.
    await s.admin.req("POST", `/agents/${agentId}/token`);
    a = await waitFor(
      () => agentOf(s.admin, houseId, agentId),
      (x) => x.online === false,
    );
    assert.equal(a.details.connection.lastClose.code, 4003);
  });

  test("command stats from the action log", async () => {
    const { houseId, agentId: okId, token: okToken } = await houseWithAgent(s.admin, "good");
    const bad = (await s.admin.req("POST", `/houses/${houseId}/agents`, { name: "bad" })).body;
    const good = new FakeAgent(s, okToken);
    const failing = new FakeAgent(s, bad.token, { reply: (m) => (m.t === "wake" ? { t: "ack", ok: false, err: "send failed" } : undefined) });
    await good.connect();
    await failing.connect();
    const dev = await s.admin.req("POST", `/houses/${houseId}/devices`, {
      name: "PC",
      action: { type: "wol", mac: "aabbccddeeff", agentIds: [okId, bad.agent.id] },
    });
    const before = Date.now();
    assert.equal((await s.admin.req("POST", `/devices/${dev.body.id}/action`, { action: "wake" })).status, 200);
    assert.equal((await s.admin.req("POST", `/devices/${dev.body.id}/action`, { action: "wake" })).status, 200);

    const g = (await agentOf(s.admin, houseId, okId)).details.stats;
    assert.equal(g.commands24h, 2);
    assert.equal(g.failed24h, 0);
    assert.ok(g.lastCommandAt >= before);
    const b = (await agentOf(s.admin, houseId, bad.agent.id)).details.stats;
    assert.equal(b.commands24h, 2);
    assert.equal(b.failed24h, 2);
    assert.equal(b.lastCommandAt, g.lastCommandAt);
    await good.close();
    await failing.close();
  });
});

describe("agent sessions across restarts", () => {
  test("a clean shutdown closes sessions with 1001; sessions left open are closed at startup", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awake-test-restart-"));
    try {
      const s = await startTestServer({ dataDir });
      const { houseId, agentId, token } = await houseWithAgent(s.admin);
      const agent = new FakeAgent(s, token);
      await agent.connect();
      await s.close();

      const file = path.join(dataDir, "awake.db");
      const db = new DatabaseSync(file);
      const row = db.prepare("SELECT connected_at, closed_at, close_code FROM agent_sessions WHERE agent_id = ?").get(agentId) as any;
      assert.equal(row.close_code, 1001);
      assert.ok(row.closed_at >= row.connected_at);
      // As if the server had been killed while the agent was connected.
      const lastSeen = row.connected_at + 5;
      db.prepare("UPDATE agent_sessions SET closed_at = NULL, close_code = NULL").run();
      db.prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(lastSeen, agentId);
      db.close();

      const config = { ...s.config, port: 0 };
      const restarted = await startServer(config);
      try {
        const client = new Client({ url: `http://127.0.0.1:${restarted.port}` });
        await client.login("admin", NEW_PASSWORD);
        const a = await agentOf(client, houseId, agentId);
        assert.equal(a.online, false);
        assert.deepEqual(a.details.connection.lastClose, { at: lastSeen, code: 1001 });
        assert.equal(a.details.connection.connections24h, 1);
      } finally {
        await restarted.close();
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
