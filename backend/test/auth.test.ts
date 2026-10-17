import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client, createUser, NEW_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

describe("bootstrap admin and own password", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("the generated password must be changed before anything else", async () => {
    // startTestServer already changed it: a fresh server shows the flow on a second user.
    const created = await s.admin.req("POST", "/admin/users", { username: "mario", credentials: { type: "password", password: "temporary-pass" } });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.mustChangePassword, true);

    const mario = new Client(s);
    const me = await mario.login("Mario", "temporary-pass"); // usernames are case-insensitive
    assert.equal(me.user.mustChangePassword, true);
    assert.equal((await mario.req("GET", "/houses")).body.error, "PASSWORD_CHANGE_REQUIRED");
    assert.equal((await mario.req("GET", "/auth/me")).status, 200);

    const wrong = await mario.req("POST", "/auth/password", { currentPassword: "nope", newPassword: NEW_PASSWORD });
    assert.equal(wrong.body.error, "WRONG_PASSWORD");
    const short = await mario.req("POST", "/auth/password", { currentPassword: "temporary-pass", newPassword: "short" });
    assert.equal(short.body.error, "INVALID_PASSWORD");

    const ok = await mario.req("POST", "/auth/password", { currentPassword: "temporary-pass", newPassword: NEW_PASSWORD });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.mustChangePassword, false);
    assert.equal((await mario.req("GET", "/houses")).status, 200);
  });

  test("changing the password ends the other sessions", async () => {
    const u = await createUser(s, "luigi");
    const other = new Client(s);
    await other.login("luigi", NEW_PASSWORD);
    await u.req("POST", "/auth/password", { currentPassword: NEW_PASSWORD, newPassword: "another long password" });
    assert.equal((await other.req("GET", "/auth/me")).status, 401);
    assert.equal((await u.req("GET", "/auth/me")).status, 200);
  });

  test("wrong credentials, unknown users and logout", async () => {
    const c = new Client(s);
    assert.equal((await c.req("POST", "/auth/login", { username: "admin", password: "wrong" })).body.error, "INVALID_CREDENTIALS");
    assert.equal((await c.req("POST", "/auth/login", { username: "ghost", password: "wrong" })).body.error, "INVALID_CREDENTIALS");
    await c.login("admin", NEW_PASSWORD);
    assert.equal((await c.req("POST", "/auth/logout")).status, 204);
    assert.equal((await c.req("GET", "/auth/me")).status, 401);
  });

  test("a cross-site origin cannot change state", async () => {
    const res = await s.admin.req("POST", "/houses", { name: "x" }, { origin: "https://evil.example" });
    assert.equal(res.status, 403);
    const form = await s.admin.req("POST", "/houses", undefined, { "content-type": "text/plain", "content-length": "3" });
    assert.notEqual(form.status, 201);
  });
});

describe("admin user management", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("set-password link", async () => {
    const res = await s.admin.req("POST", "/admin/users", { username: "anna", credentials: { type: "link" } });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.hasPassword, false);
    const token = new URL(res.body.link.url).hash.slice(1);
    assert.ok(res.body.link.url.startsWith(`${s.config.publicUrl}/set-password#`));

    const anon = new Client(s);
    assert.equal((await anon.req("POST", "/auth/password-link/inspect", { token })).body.username, "anna");
    assert.equal((await anon.req("POST", "/auth/password-link", { token, password: NEW_PASSWORD })).status, 204);
    // One use only.
    assert.equal((await anon.req("POST", "/auth/password-link", { token, password: NEW_PASSWORD })).body.error, "INVALID_TOKEN");
    const me = await anon.login("anna", NEW_PASSWORD);
    assert.equal(me.user.mustChangePassword, false);
  });

  test("non-admins cannot manage users", async () => {
    const u = await createUser(s, "plain");
    assert.equal((await u.req("GET", "/admin/users")).status, 403);
  });

  test("disable revokes sessions, the last admin is protected", async () => {
    const u = await createUser(s, "tobedisabled");
    const res = await s.admin.req("PATCH", `/admin/users/${u.id}`, { status: "disabled" });
    assert.equal(res.body.status, "disabled");
    assert.equal((await u.req("GET", "/auth/me")).status, 401);
    assert.equal((await new Client(s).req("POST", "/auth/login", { username: "tobedisabled", password: NEW_PASSWORD })).body.error, "ACCOUNT_DISABLED");

    const adminId = (await s.admin.req("GET", "/auth/me")).body.user.id;
    assert.equal((await s.admin.req("PATCH", `/admin/users/${adminId}`, { admin: false })).body.error, "CANNOT_TARGET_SELF");
    assert.equal((await s.admin.req("DELETE", `/admin/users/${adminId}`)).body.error, "CANNOT_TARGET_SELF");

    // A second admin can be demoted while the first remains.
    const second = await createUser(s, "second");
    await s.admin.req("PATCH", `/admin/users/${second.id}`, { admin: true });
    assert.equal((await second.req("GET", "/admin/users")).status, 200);
    assert.equal((await second.req("PATCH", `/admin/users/${adminId}`, { admin: false })).body.admin, false);
    // Now `second` is the last admin.
    assert.equal((await second.req("PATCH", `/admin/users/${second.id}`, { admin: false })).body.error, "CANNOT_TARGET_SELF");
    // Restore the admin used by the next tests.
    assert.equal((await second.req("PATCH", `/admin/users/${adminId}`, { admin: true })).body.admin, true);
  });

  test("duplicate usernames and invalid ones", async () => {
    assert.equal((await s.admin.req("POST", "/admin/users", { username: "admin", credentials: { type: "link" } })).body.error, "USERNAME_TAKEN");
    assert.equal((await s.admin.req("POST", "/admin/users", { username: "a b", credentials: { type: "link" } })).body.error, "INVALID_USERNAME");
  });

  test("deleting a user deletes every house they own, also co-owned ones", async () => {
    const u = await createUser(s, "leaving");
    const other = await createUser(s, "staying");
    const mine = (await u.req("POST", "/houses", { name: "Mine" })).body;
    const coOwned = (await u.req("POST", "/houses", { name: "Shared ownership" })).body;
    await u.req("POST", `/houses/${coOwned.id}/members`, { username: "staying", role: "owner" });
    const theirs = (await other.req("POST", "/houses", { name: "Theirs" })).body;
    await other.req("POST", `/houses/${theirs.id}/members`, { username: "leaving", role: "member" });

    assert.equal((await s.admin.req("DELETE", `/admin/users/${u.id}`)).status, 204);
    assert.equal((await s.admin.req("GET", "/admin/users")).body.some((x: any) => x.username === "leaving"), false);
    const left = (await other.req("GET", "/houses")).body.map((h: any) => h.id);
    assert.deepEqual(left, [theirs.id]);
    assert.ok(!left.includes(mine.id) && !left.includes(coOwned.id));
    assert.deepEqual(
      (await other.req("GET", `/houses/${theirs.id}/members`)).body.map((m: any) => m.username),
      ["staying"],
    );
  });
});

describe("registration", () => {
  test("disabled by default", async () => {
    const s = await startTestServer();
    try {
      const res = await new Client(s).req("POST", "/auth/register", { username: "newbie", password: NEW_PASSWORD });
      assert.equal(res.body.error, "REGISTRATION_DISABLED");
      assert.deepEqual((await new Client(s).req("GET", "/config")).body.registration, { enabled: false, autoApprove: false });
    } finally {
      await s.close();
    }
  });

  test("with approval: pending until an admin approves", async () => {
    const s = await startTestServer();
    try {
      await s.admin.req("PUT", "/admin/settings", { registrationEnabled: true, autoApprove: false });
      const c = new Client(s);
      const res = await c.req("POST", "/auth/register", { username: "newbie", password: NEW_PASSWORD });
      assert.equal(res.status, 202);
      assert.equal(res.body.status, "pending");
      assert.equal((await c.req("POST", "/auth/login", { username: "newbie", password: NEW_PASSWORD })).body.error, "ACCOUNT_PENDING");

      const users = (await s.admin.req("GET", "/admin/users")).body;
      const newbie = users.find((u: any) => u.username === "newbie");
      assert.equal(newbie.status, "pending");
      await s.admin.req("PATCH", `/admin/users/${newbie.id}`, { status: "active" });
      await c.login("newbie", NEW_PASSWORD);
    } finally {
      await s.close();
    }
  });

  test("with auto-approval: logged in right away", async () => {
    const s = await startTestServer();
    try {
      await s.admin.req("PUT", "/admin/settings", { registrationEnabled: true, autoApprove: true });
      assert.deepEqual((await new Client(s).req("GET", "/config")).body.registration, { enabled: true, autoApprove: true });
      const c = new Client(s);
      const res = await c.req("POST", "/auth/register", { username: "quick", password: NEW_PASSWORD });
      assert.equal(res.status, 201);
      assert.equal(res.body.me.user.username, "quick");
      assert.equal((await c.req("GET", "/houses")).status, 200);
    } finally {
      await s.close();
    }
  });
});

describe("rate limiting", () => {
  test("too many failed logins from one IP", async () => {
    const s = await startTestServer();
    try {
      const c = new Client(s);
      for (let i = 0; i < 10; i++) await c.req("POST", "/auth/login", { username: "admin", password: "wrong" });
      const res = await c.req("POST", "/auth/login", { username: "admin", password: NEW_PASSWORD });
      assert.equal(res.status, 429);
    } finally {
      await s.close();
    }
  });
});
