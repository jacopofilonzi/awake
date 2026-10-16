import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createUser, FakeAgent, houseWithAgent, startTestServer, waitFor, type TestServer } from "./helpers.ts";

describe("Wake-on-LAN devices", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("wake, then the check loop sees it online", async () => {
    const { houseId, agentId, token } = await houseWithAgent(s.admin);
    let up = false;
    const agent = new FakeAgent(s, token, { probe: () => up });
    await agent.connect();

    const created = await s.admin.req("POST", `/houses/${houseId}/devices`, {
      name: "PC",
      ip: "192.168.1.20",
      probePort: 3389,
      action: { type: "wol", mac: "aa-bb-cc-dd-ee-ff", agentIds: [agentId] },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.actions, ["wake"]);
    assert.equal(created.body.config.action.mac, "AA:BB:CC:DD:EE:FF");
    const id = created.body.id;

    const checked = await s.admin.req("POST", "/devices/check", { ids: [id] });
    assert.equal(checked.body.statuses[id].reach.state, "offline");
    assert.deepEqual(agent.received.at(-1), { t: "probe", id: agent.received.at(-1).id, ip: "192.168.1.20", port: 3389, timeout: 100 });

    const res = await s.admin.req("POST", `/devices/${id}/action`, { action: "wake" });
    assert.equal(res.status, 200);
    assert.equal(res.body.status.reach.state, "waking");
    assert.equal(res.body.results[0].status, "ok");
    assert.ok(agent.received.some((m) => m.t === "wake" && m.mac === "AA:BB:CC:DD:EE:FF"));
    assert.equal((await s.admin.req("POST", `/devices/${id}/action`, { action: "wake" })).body.error, "ALREADY_WAKING");

    up = true;
    const online = await waitFor(
      () => s.admin.req("GET", "/devices/status"),
      (r) => r.body.statuses[id].reach.state === "online",
    );
    assert.equal(online.status, 200);
    const log = await waitFor(
      () => s.admin.req("GET", "/log"),
      (r) => r.body[0]?.outcome === "online",
    );
    assert.equal(log.body[0].action, "wake");
    assert.equal(log.body[0].actor.username, "admin");
    assert.ok(log.body[0].onlineAfterMs >= 0);
    await agent.close();
  });

  test("errors: no agents, agents offline, failing agent", async () => {
    const { houseId, agentId, token } = await houseWithAgent(s.admin, "flaky");
    const none = await s.admin.req("POST", `/houses/${houseId}/devices`, { name: "A", action: { type: "wol", mac: "aabbccddeeff" } });
    assert.equal((await s.admin.req("POST", `/devices/${none.body.id}/action`, { action: "wake" })).body.error, "NO_AGENTS_ASSIGNED");

    const dev = await s.admin.req("POST", `/houses/${houseId}/devices`, { name: "B", action: { type: "wol", mac: "aabbccddeeff", agentIds: [agentId] } });
    assert.equal((await s.admin.req("POST", `/devices/${dev.body.id}/action`, { action: "wake" })).body.error, "NO_AGENTS_ONLINE");

    const agent = new FakeAgent(s, token, { reply: (m) => (m.t === "wake" ? { t: "ack", ok: false, err: "send failed" } : undefined) });
    await agent.connect();
    const failed = await s.admin.req("POST", `/devices/${dev.body.id}/action`, { action: "wake" });
    assert.equal(failed.status, 502);
    assert.equal(failed.body.error, "ACTION_FAILED");
    assert.deepEqual(failed.body.results[0], { agentId, agentName: "flaky", status: "error", err: "send failed" });
    await agent.close();

    const bad = await s.admin.req("POST", `/houses/${houseId}/devices`, { name: "C", action: { type: "wol", mac: "zz" } });
    assert.equal(bad.body.error, "INVALID_MAC");
  });
});

describe("output devices", () => {
  let s: TestServer;
  let houseId: string;
  let agentId: string;
  let agent: FakeAgent;
  let token: string;
  const outputs = [
    { id: "pc-power", mode: "button" as const, long: true },
    { id: "bell", mode: "button" as const },
    { id: "lamp", mode: "switch" as const, on: false },
  ];

  before(async () => {
    s = await startTestServer();
    ({ houseId, agentId, token } = await houseWithAgent(s.admin));
    agent = new FakeAgent(s, token, { outputs });
    await agent.connect();
  });
  after(async () => {
    await agent.close();
    await s.close();
  });

  const create = (name: string, outputId: string, extra: object = {}) =>
    s.admin.req("POST", `/houses/${houseId}/devices`, { name, action: { type: "output", agentId, outputId }, ...extra });

  test("the agent's outputs are listed", async () => {
    const agents = (await s.admin.req("GET", `/houses/${houseId}/agents`)).body;
    assert.equal(agents[0].online, true);
    assert.equal(agents[0].firmware, "fake/1");
    assert.deepEqual(agents[0].outputs, [
      { id: "bell", mode: "button", long: false, on: null, deviceId: null },
      { id: "lamp", mode: "switch", long: false, on: false, deviceId: null },
      { id: "pc-power", mode: "button", long: true, on: null, deviceId: null },
    ]);
  });

  test("buttons: short and long press; long only when configured", async () => {
    const pc = await create("Server", "pc-power");
    assert.deepEqual(pc.body.actions, ["press", "long_press"]);
    const bell = await create("Bell", "bell");
    assert.deepEqual(bell.body.actions, ["press"]);

    assert.equal((await s.admin.req("POST", `/devices/${pc.body.id}/action`, { action: "long_press" })).status, 200);
    assert.deepEqual(agent.received.at(-1), { t: "press", id: agent.received.at(-1).id, out: "pc-power", long: true });
    assert.equal((await s.admin.req("POST", `/devices/${bell.body.id}/action`, { action: "press" })).status, 200);
    assert.deepEqual(agent.received.at(-1), { t: "press", id: agent.received.at(-1).id, out: "bell" });
    assert.equal((await s.admin.req("POST", `/devices/${bell.body.id}/action`, { action: "long_press" })).body.error, "ACTION_NOT_SUPPORTED");
    assert.equal((await s.admin.req("POST", `/devices/${bell.body.id}/action`, { action: "wake" })).body.error, "ACTION_NOT_SUPPORTED");

    assert.equal((await create("Again", "bell")).body.error, "OUTPUT_IN_USE");
    assert.equal((await create("Missing", "nope")).body.error, "OUTPUT_NOT_FOUND");
  });

  test("switches: set from the dashboard, changes from the agent", async () => {
    const lamp = await create("Lamp", "lamp");
    const id = lamp.body.id;
    assert.deepEqual(lamp.body.actions, ["on", "off"]);
    assert.equal(lamp.body.status.output.on, false);

    const on = await s.admin.req("POST", `/devices/${id}/action`, { action: "on" });
    assert.equal(on.body.status.output.on, true);
    assert.deepEqual(agent.received.at(-1), { t: "set", id: agent.received.at(-1).id, out: "lamp", on: true });

    // A physical button wired to the agent turns it off.
    agent.toggleLocally("lamp", false);
    await waitFor(
      () => s.admin.req("GET", "/devices/status"),
      (r) => r.body.statuses[id].output.on === false,
    );
    const log = (await s.admin.req("GET", "/log")).body;
    assert.equal(log[0].source, "agent");
    assert.equal(log[0].action, "off");
    assert.equal(log[0].actor, null);
    assert.equal(log[1].source, "user");
    assert.equal(log[1].action, "on");

    // Changed while disconnected: the next hello brings the new state.
    await agent.close();
    const offline = (
      await waitFor(
        () => s.admin.req("GET", "/devices/status"),
        (r) => r.body.statuses[id].output.available === false,
      )
    ).body.statuses[id];
    assert.equal(offline.output.available, false);
    assert.equal(offline.ready, false);
    assert.equal((await s.admin.req("POST", `/devices/${id}/action`, { action: "on" })).body.error, "AGENT_OFFLINE");
    agent.switches.set("lamp", true);
    await agent.connect();
    const back = (await s.admin.req("GET", "/devices/status")).body.statuses[id];
    assert.equal(back.output.on, true);
    assert.equal(back.output.available, true);
    assert.equal((await s.admin.req("GET", "/log")).body[0].action, "on");
  });

  test("an output the agent no longer declares makes its device unavailable", async () => {
    const pc = (await s.admin.req("GET", "/devices")).body.find((d: any) => d.name === "Server");
    await agent.close();
    const reduced = new FakeAgent(s, token, { outputs: outputs.filter((o) => o.id !== "pc-power") });
    await reduced.connect();
    const status = (await s.admin.req("GET", "/devices/status")).body.statuses[pc.id];
    assert.equal(status.output.available, false);
    assert.equal(status.output.mode, "button");
    assert.equal((await s.admin.req("POST", `/devices/${pc.id}/action`, { action: "press" })).body.error, "OUTPUT_UNAVAILABLE");
    await reduced.close();
    await agent.connect();
  });
});

describe("houses, roles and sharing", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("members, editors and direct shares", async () => {
    const owner = await createUser(s, "owner");
    const editor = await createUser(s, "editor");
    const member = await createUser(s, "member");
    const friend = await createUser(s, "friend");
    const stranger = await createUser(s, "stranger");

    const { houseId, agentId, token } = await houseWithAgent(owner);
    const agent = new FakeAgent(s, token, { outputs: [{ id: "lamp", mode: "switch", on: false }] });
    await agent.connect();
    const lamp = (await owner.req("POST", `/houses/${houseId}/devices`, { name: "Lamp", action: { type: "output", agentId, outputId: "lamp" } })).body;

    assert.equal((await owner.req("POST", `/houses/${houseId}/members`, { username: "editor", role: "editor" })).status, 201);
    assert.equal((await owner.req("POST", `/houses/${houseId}/members`, { username: "member", role: "member" })).status, 201);
    assert.equal((await owner.req("POST", `/houses/${houseId}/members`, { username: "member", role: "member" })).body.error, "ALREADY_MEMBER");
    assert.equal((await owner.req("POST", `/houses/${houseId}/members`, { username: "nobody", role: "member" })).body.error, "USER_NOT_FOUND");

    // Editor: manages devices and agents, not members.
    assert.equal((await editor.req("GET", "/devices")).body[0].config.action.outputId, "lamp");
    assert.equal((await editor.req("POST", `/houses/${houseId}/agents`, { name: "second" })).status, 201);
    assert.equal((await editor.req("POST", `/houses/${houseId}/members`, { username: "friend", role: "member" })).status, 403);

    // Member: sees and uses, no config, no results.
    const seen = (await member.req("GET", "/devices")).body[0];
    assert.equal(seen.access, "member");
    assert.equal(seen.config, null);
    const acted = await member.req("POST", `/devices/${lamp.id}/action`, { action: "on" });
    assert.equal(acted.status, 200);
    assert.equal(acted.body.results, undefined);
    assert.equal((await member.req("PUT", `/devices/${lamp.id}`, { name: "x", action: { type: "output", agentId, outputId: "lamp" } })).status, 403);
    assert.equal((await member.req("POST", `/houses/${houseId}/agents`, { name: "x" })).status, 403);

    // Direct share: one device, use only.
    assert.equal((await owner.req("POST", `/devices/${lamp.id}/shares`, { username: "friend" })).status, 201);
    assert.equal((await owner.req("POST", `/devices/${lamp.id}/shares`, { username: "member" })).body.error, "ALREADY_HAS_ACCESS");
    const shared = (await friend.req("GET", "/devices")).body;
    assert.equal(shared.length, 1);
    assert.equal(shared[0].access, "shared");
    assert.equal(shared[0].config, null);
    assert.equal((await friend.req("POST", `/devices/${lamp.id}/action`, { action: "off" })).status, 200);
    assert.equal((await friend.req("GET", `/houses/${houseId}/agents`)).status, 404);
    const friendLog = (await friend.req("GET", "/log")).body;
    assert.equal(friendLog.length, 1);
    assert.equal(friendLog[0].results, null);

    // Strangers see nothing, and ids of others' resources are not confirmed.
    assert.deepEqual((await stranger.req("GET", "/devices")).body, []);
    assert.equal((await stranger.req("POST", `/devices/${lamp.id}/action`, { action: "on" })).status, 404);
    assert.equal((await stranger.req("GET", `/houses/${houseId}/members`)).status, 404);

    // The recipient can drop the share; owners can revoke it.
    assert.equal((await friend.req("DELETE", `/shared/${lamp.id}`)).status, 204);
    assert.deepEqual((await friend.req("GET", "/devices")).body, []);

    // The last owner cannot leave or be demoted; members can leave.
    const ownerId = (await owner.req("GET", "/auth/me")).body.user.id;
    assert.equal((await owner.req("DELETE", `/houses/${houseId}/members/${ownerId}`)).body.error, "LAST_OWNER");
    assert.equal((await owner.req("PATCH", `/houses/${houseId}/members/${ownerId}`, { role: "member" })).body.error, "LAST_OWNER");
    assert.equal((await member.req("DELETE", `/houses/${houseId}/members/${member.id}`)).status, 204);
    assert.deepEqual((await member.req("GET", "/devices")).body, []);

    // Deleting the house disconnects its agents.
    assert.equal((await owner.req("DELETE", `/houses/${houseId}`)).status, 204);
    await waitFor(
      () => agent.closeCode,
      (code) => code === 4003,
    );
  });

  test("live events reach the users who can see the device", async () => {
    const owner = await createUser(s, "live");
    const { houseId, agentId, token } = await houseWithAgent(owner);
    const agent = new FakeAgent(s, token, { outputs: [{ id: "lamp", mode: "switch", on: false }] });
    await agent.connect();
    const lamp = (await owner.req("POST", `/houses/${houseId}/devices`, { name: "Lamp", action: { type: "output", agentId, outputId: "lamp" } })).body;

    const ac = new AbortController();
    const res = await fetch(`${s.url}/api/events`, {
      headers: { cookie: [...owner.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      signal: ac.signal,
    });
    assert.equal(res.headers.get("content-type")?.split(";")[0], "text/event-stream");
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
    agent.toggleLocally("lamp", true);
    await readUntil(`"id":"${lamp.id}"`);
    const line = text.split("\n").find((l) => l.startsWith("data:") && l.includes(lamp.id))!;
    const event = JSON.parse(line.slice(5));
    assert.equal(event.type, "device");
    assert.equal(event.status.output.on, true);
    ac.abort();
    await agent.close();
  });
});
