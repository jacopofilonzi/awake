import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { FakeAgent, houseWithAgent, rawAgent, startTestServer, waitFor, type TestServer } from "./helpers.ts";

describe("agent protocol", () => {
  let s: TestServer;
  let token: string;
  let agentId: string;
  before(async () => {
    s = await startTestServer();
    ({ token, agentId } = await houseWithAgent(s.admin));
  });
  after(() => s.close());

  test("handshake errors close with the documented codes", async () => {
    assert.equal(await rawAgent(s, "not json"), 4000);
    assert.equal(await rawAgent(s, { t: "hb" }), 4000);
    assert.equal(await rawAgent(s, { t: "hello", v: 2, token }), 4004);
    assert.equal(await rawAgent(s, { t: "hello", v: 1, token: "awk_wrong" }), 4001);
    const invalidOutputs = [
      [{ id: "Bad Id", mode: "button" }],
      [{ id: "a", mode: "dimmer" }],
      [{ id: "a", mode: "switch" }],
      [
        { id: "a", mode: "button" },
        { id: "a", mode: "button" },
      ],
    ];
    for (const outputs of invalidOutputs) assert.equal(await rawAgent(s, { t: "hello", v: 1, token, outputs }), 4000);
  });

  test("hello timeout", async () => {
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(s.wsUrl);
      ws.addEventListener("close", (e) => resolve(e.code));
    });
    assert.equal(code, 4008);
  });

  test("welcome, heartbeat, replaced connection, revoked token", async () => {
    const first = new FakeAgent(s, token);
    const welcome = await first.connect();
    assert.deepEqual(welcome, { t: "welcome", v: 1, name: "agent-1", hb: 1 });

    const second = new FakeAgent(s, token);
    await second.connect();
    await waitFor(
      () => first.closeCode,
      (c) => c === 4002,
    );
    const agents = (await s.admin.req("GET", `/houses/${(await s.admin.req("GET", "/houses")).body[0].id}/agents`)).body;
    assert.equal(agents.find((a: any) => a.id === agentId).online, true);

    const regenerated = await s.admin.req("POST", `/agents/${agentId}/token`);
    await waitFor(
      () => second.closeCode,
      (c) => c === 4003,
    );
    token = regenerated.body.token;
    assert.equal(await rawAgent(s, { t: "hello", v: 1, token: "awk_old" }), 4001);
    const third = new FakeAgent(s, token);
    await third.connect();
    await third.close();
  });

  test("a silent ack is a timeout, unknown messages are ignored", async () => {
    const houses = (await s.admin.req("GET", "/houses")).body;
    const agent = new FakeAgent(s, token, { outputs: [{ id: "bell", mode: "button" }], reply: (m) => (m.t === "press" ? null : undefined) });
    await agent.connect();
    agent.send({ t: "future_message", whatever: 1 });
    const dev = await s.admin.req("POST", `/houses/${houses[0].id}/devices`, { name: "Bell", action: { type: "output", agentId, outputId: "bell" } });
    const res = await s.admin.req("POST", `/devices/${dev.body.id}/action`, { action: "press" });
    assert.equal(res.body.error, "ACTION_FAILED");
    assert.equal(res.body.results[0].status, "timeout");
    await agent.close();
  });

  test("too many bad tokens from one IP are rate limited", async () => {
    for (let i = 0; i < 10; i++) await rawAgent(s, { t: "hello", v: 1, token: "awk_bad" });
    assert.equal(await rawAgent(s, { t: "hello", v: 1, token }), 4029);
  });
});
