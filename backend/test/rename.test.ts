// Admins rename users, themselves included (e.g. the bootstrap "admin" after the first setup).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client, createUser, NEW_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

describe("renaming users", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("an admin renames another user, who then logs in with the new name only", async () => {
    const u = await createUser(s, "mario");
    const res = await s.admin.req("PATCH", `/admin/users/${u.id}`, { username: "Mario.Rossi" });
    assert.equal(res.status, 200);
    assert.equal(res.body.username, "mario.rossi");
    assert.equal((await u.req("GET", "/auth/me")).body.user.username, "mario.rossi", "the session survives the rename");
    assert.equal((await new Client(s).req("POST", "/auth/login", { username: "mario", password: NEW_PASSWORD })).body.error, "INVALID_CREDENTIALS");
    assert.equal((await new Client(s).req("POST", "/auth/login", { username: "mario.rossi", password: NEW_PASSWORD })).status, 200);
  });

  test("the bootstrap admin renames itself and stays logged in", async () => {
    const me = (await s.admin.req("GET", "/auth/me")).body.user;
    const res = await s.admin.req("PATCH", `/admin/users/${me.id}`, { username: "jacopo" });
    assert.equal(res.status, 200);
    const after = (await s.admin.req("GET", "/auth/me")).body.user;
    assert.deepEqual([after.username, after.admin], ["jacopo", true]);
    await s.admin.req("PATCH", `/admin/users/${me.id}`, { username: "admin" }); // other tests log in as admin
  });

  test("taken or invalid usernames are refused", async () => {
    const a = await createUser(s, "anna");
    await createUser(s, "luca");
    const taken = await s.admin.req("PATCH", `/admin/users/${a.id}`, { username: "LUCA" });
    assert.deepEqual([taken.status, taken.body.error], [409, "USERNAME_TAKEN"]);
    const invalid = await s.admin.req("PATCH", `/admin/users/${a.id}`, { username: "a b" });
    assert.deepEqual([invalid.status, invalid.body.error], [400, "INVALID_USERNAME"]);
  });

  test("users who are not admins cannot rename anyone", async () => {
    const u = await createUser(s, "plain");
    assert.notEqual((await u.req("PATCH", `/admin/users/${u.id}`, { username: "plain2" })).status, 200);
  });
});
