import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import { migrations, openDb } from "../src/db.ts";
import { createUser, startTestServer, type TestServer } from "./helpers.ts";

describe("house icons", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("default icon, chosen icon, invalid icon", async () => {
    const plain = await s.admin.req("POST", "/houses", { name: "Casa" });
    assert.equal(plain.status, 201);
    assert.equal(plain.body.icon, "house");

    const office = await s.admin.req("POST", "/houses", { name: "Ufficio", icon: "building-2" });
    assert.equal(office.body.icon, "building-2");
    const listed = (await s.admin.req("GET", "/houses")).body.find((h: any) => h.id === office.body.id);
    assert.equal(listed.icon, "building-2");

    const bad = await s.admin.req("POST", "/houses", { name: "X", icon: "rocket" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "VALIDATION");
  });

  test("PATCH changes the icon, the name or both; an empty patch is invalid", async () => {
    const { id } = (await s.admin.req("POST", "/houses", { name: "Mare" })).body;
    let res = await s.admin.req("PATCH", `/houses/${id}`, { icon: "waves" });
    assert.deepEqual([res.body.name, res.body.icon], ["Mare", "waves"]);
    res = await s.admin.req("PATCH", `/houses/${id}`, { name: "Casa al mare" });
    assert.deepEqual([res.body.name, res.body.icon], ["Casa al mare", "waves"]);
    res = await s.admin.req("PATCH", `/houses/${id}`, { name: "Mare", icon: "mountain" });
    assert.deepEqual([res.body.name, res.body.icon], ["Mare", "mountain"]);
    assert.equal((await s.admin.req("PATCH", `/houses/${id}`, {})).status, 400);
    assert.equal((await s.admin.req("PATCH", `/houses/${id}`, { icon: "rocket" })).status, 400);
  });

  test("only owners change the icon", async () => {
    const { id } = (await s.admin.req("POST", "/houses", { name: "Condivisa" })).body;
    const editor = await createUser(s, "icon-editor");
    await s.admin.req("POST", `/houses/${id}/members`, { username: "icon-editor", role: "editor" });
    const res = await editor.req("PATCH", `/houses/${id}`, { icon: "store" });
    assert.notEqual(res.status, 200);
    assert.equal((await s.admin.req("GET", "/houses")).body.find((h: any) => h.id === id).icon, "house");
  });
});

test("migration 4: existing houses get the default icon", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awake-mig4-"));
  try {
    // A database at version 3 with a user owning a house, as a released server would have left it.
    const old = new DatabaseSync(path.join(dir, "awake.db"));
    for (const m of migrations.slice(0, 3)) old.exec(m);
    old.exec("PRAGMA user_version = 3");
    old.prepare("INSERT INTO users (id, username, status, created_at) VALUES ('u1', 'jacopo', 'active', 1)").run();
    old.prepare("INSERT INTO houses (id, name, created_at) VALUES ('h1', 'Casa Filonzi', 2)").run();
    old.prepare("INSERT INTO house_members (house_id, user_id, role, created_at) VALUES ('h1', 'u1', 'owner', 2)").run();
    old.close();

    const db = openDb(dir);
    assert.deepEqual({ ...(db.prepare("SELECT name, icon FROM houses WHERE id = 'h1'").get() as object) }, { name: "Casa Filonzi", icon: "house" });
    db.close();
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("awake.db.bak-v3-")), "backup made before migrating");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
