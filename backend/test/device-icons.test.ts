import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import { migrations, openDb } from "../src/db.ts";
import { createUser, houseWithAgent, startTestServer, type TestServer } from "./helpers.ts";

const wol = (agentId: string) => ({ type: "wol", mac: "aa-bb-cc-dd-ee-ff", agentIds: [agentId] });

describe("device icons", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("chosen icon, automatic by default, invalid icon", async () => {
    const { houseId, agentId } = await houseWithAgent(s.admin);
    const tv = await s.admin.req("POST", `/houses/${houseId}/devices`, { name: "TV", icon: "tv", action: wol(agentId) });
    assert.equal(tv.status, 201);
    assert.equal(tv.body.icon, "tv");
    assert.equal(tv.body.config.icon, undefined, "the icon is not config");
    const listed = (await s.admin.req("GET", "/devices")).body.find((d: any) => d.id === tv.body.id);
    assert.equal(listed.icon, "tv");

    const plain = await s.admin.req("POST", `/houses/${houseId}/devices`, { name: "PC", action: wol(agentId) });
    assert.equal(plain.status, 201);
    assert.equal(plain.body.icon, null);

    const bad = await s.admin.req("POST", `/houses/${houseId}/devices`, { name: "X", icon: "rocket", action: wol(agentId) });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "VALIDATION");
  });

  test("PUT changes the icon; null (or no icon) sets it back to automatic", async () => {
    const { houseId, agentId } = await houseWithAgent(s.admin, "agent-put");
    const { id } = (await s.admin.req("POST", `/houses/${houseId}/devices`, { name: "NAS", action: wol(agentId) })).body;
    let res = await s.admin.req("PUT", `/devices/${id}`, { name: "NAS", icon: "hard-drive", action: wol(agentId) });
    assert.equal(res.status, 200);
    assert.equal(res.body.icon, "hard-drive");
    res = await s.admin.req("PUT", `/devices/${id}`, { name: "NAS", icon: null, action: wol(agentId) });
    assert.equal(res.body.icon, null);
    await s.admin.req("PUT", `/devices/${id}`, { name: "NAS", icon: "server", action: wol(agentId) });
    res = await s.admin.req("PUT", `/devices/${id}`, { name: "NAS", action: wol(agentId) });
    assert.equal(res.body.icon, null);
    assert.equal((await s.admin.req("PUT", `/devices/${id}`, { name: "NAS", icon: "rocket", action: wol(agentId) })).status, 400);
  });

  test("members and direct shares see the icon, not the config", async () => {
    const owner = await createUser(s, "icon-owner");
    const member = await createUser(s, "icon-member");
    const friend = await createUser(s, "icon-friend");
    const { houseId, agentId } = await houseWithAgent(owner);
    const { id } = (await owner.req("POST", `/houses/${houseId}/devices`, { name: "Coffee", icon: "coffee", action: wol(agentId) })).body;
    assert.equal((await owner.req("POST", `/houses/${houseId}/members`, { username: "icon-member", role: "member" })).status, 201);
    assert.equal((await owner.req("POST", `/devices/${id}/shares`, { username: "icon-friend" })).status, 201);

    for (const viewer of [member, friend]) {
      const seen = (await viewer.req("GET", "/devices")).body.find((d: any) => d.id === id);
      assert.equal(seen.icon, "coffee");
      assert.equal(seen.config, null);
    }
  });
});

test("migration 5: existing devices stay automatic", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awake-mig5-"));
  try {
    // A database at version 4 with a user owning a house with an agent and a device, as a released server would have left it.
    const old = new DatabaseSync(path.join(dir, "awake.db"));
    for (const m of migrations.slice(0, 4)) old.exec(m);
    old.exec("PRAGMA user_version = 4");
    old.prepare("INSERT INTO users (id, username, status, created_at) VALUES ('u1', 'jacopo', 'active', 1)").run();
    old.prepare("INSERT INTO houses (id, name, icon, created_at) VALUES ('h1', 'Casa Filonzi', 'house', 2)").run();
    old.prepare("INSERT INTO house_members (house_id, user_id, role, created_at) VALUES ('h1', 'u1', 'owner', 2)").run();
    old.prepare("INSERT INTO agents (id, house_id, name, token_hash, created_at) VALUES ('a1', 'h1', 'raspberry', 'hash', 3)").run();
    old
      .prepare("INSERT INTO devices (id, house_id, name, kind, mac, ip, probe_port, created_at) VALUES ('d1', 'h1', 'PC studio', 'wol', 'AA:BB:CC:DD:EE:FF', '192.168.1.20', 3389, 4)")
      .run();
    old.prepare("INSERT INTO device_agents (device_id, agent_id) VALUES ('d1', 'a1')").run();
    old.close();

    const db = openDb(dir);
    assert.deepEqual({ ...(db.prepare("SELECT name, mac, icon FROM devices WHERE id = 'd1'").get() as object) }, {
      name: "PC studio",
      mac: "AA:BB:CC:DD:EE:FF",
      icon: null,
    });
    db.close();
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("awake.db.bak-v4-")), "backup made before migrating");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
