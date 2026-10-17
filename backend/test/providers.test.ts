import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import { Client, createUser, startTestServer, type TestServer } from "./helpers.ts";

const github = { id: "gh", label: "GitHub", type: "github", issuer: null, clientId: "gh-client", clientSecret: "gh-secret-value", scopes: "read:user user:email" };
const authentik = {
  id: "auth-home",
  label: "Authentik",
  type: "oidc",
  issuer: "https://auth.example.com/application/o/awake/",
  clientId: "ak-client",
  clientSecret: "ak-secret-value",
  scopes: "openid email profile",
  allowSignup: true,
};

/** Direct access to the server's database file, to check what is stored at rest. */
function raw(s: TestServer) {
  return new DatabaseSync(path.join(s.config.dataDir, "awake.db"));
}

describe("server settings", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("defaults, update, public config", async () => {
    assert.deepEqual((await s.admin.req("GET", "/admin/settings")).body, { registrationEnabled: false, autoApprove: false, secretKeyConfigured: true });
    const res = await s.admin.req("PUT", "/admin/settings", { registrationEnabled: true, autoApprove: false });
    assert.equal(res.body.registrationEnabled, true);
    assert.deepEqual((await new Client(s).req("GET", "/config")).body.registration, { enabled: true, autoApprove: false });
  });

  test("admins only", async () => {
    const u = await createUser(s, "plain");
    assert.equal((await u.req("GET", "/admin/settings")).status, 403);
    assert.equal((await u.req("GET", "/admin/providers")).status, 403);
    assert.equal((await u.req("POST", "/admin/providers", github)).status, 403);
  });
});

describe("login providers", () => {
  let s: TestServer;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test("any number, several of the same type; secrets sealed and never returned", async () => {
    assert.equal((await s.admin.req("POST", "/admin/providers", github)).status, 201);
    assert.equal((await s.admin.req("POST", "/admin/providers", authentik)).status, 201);
    const second = await s.admin.req("POST", "/admin/providers", { ...authentik, id: "auth-office", label: "Authentik ufficio" });
    assert.equal(second.status, 201);
    assert.equal(second.body.redirectUri, `${s.config.publicUrl}/api/auth/oauth/auth-office/callback`);

    const list = (await s.admin.req("GET", "/admin/providers")).body;
    assert.deepEqual(list.map((p: any) => p.id).sort(), ["auth-home", "auth-office", "gh"]);
    assert.ok(list.every((p: any) => !("clientSecret" in p)));
    assert.equal(JSON.stringify(list).includes("secret-value"), false);

    const db = raw(s);
    const rows = db.prepare("SELECT client_secret_enc FROM oauth_providers").all() as { client_secret_enc: string }[];
    db.close();
    assert.ok(rows.every((r) => r.client_secret_enc.startsWith("v1.") && !r.client_secret_enc.includes("secret-value")));

    const config = (await new Client(s).req("GET", "/config")).body;
    assert.deepEqual(config.providers.map((p: any) => p.id).sort(), ["auth-home", "auth-office", "gh"]);
  });

  test("validation", async () => {
    assert.equal((await s.admin.req("POST", "/admin/providers", github)).body.error, "PROVIDER_ID_TAKEN");
    assert.equal((await s.admin.req("POST", "/admin/providers", { ...github, id: "Bad Id" })).body.error, "VALIDATION");
    const noIssuer = await s.admin.req("POST", "/admin/providers", { ...authentik, id: "x", issuer: null });
    assert.deepEqual([noIssuer.body.error, noIssuer.body.field], ["VALIDATION", "issuer"]);
    const noSecret = await s.admin.req("POST", "/admin/providers", { ...github, id: "y", clientSecret: "" });
    assert.deepEqual([noSecret.body.error, noSecret.body.field], ["VALIDATION", "clientSecret"]);
  });

  test("update keeps the secret unless a new one is given; disabled providers leave the login page", async () => {
    const sealed = () => {
      const db = raw(s);
      const v = (db.prepare("SELECT client_secret_enc FROM oauth_providers WHERE id = 'gh'").get() as { client_secret_enc: string }).client_secret_enc;
      db.close();
      return v;
    };
    const before = sealed();
    const res = await s.admin.req("PUT", "/admin/providers/gh", { ...github, label: "GitHub lavoro", clientSecret: "", enabled: false });
    assert.equal(res.body.label, "GitHub lavoro");
    assert.equal(sealed(), before);
    assert.equal((await new Client(s).req("GET", "/config")).body.providers.some((p: any) => p.id === "gh"), false);
    await s.admin.req("PUT", "/admin/providers/gh", { ...github, clientSecret: "rotated", enabled: true });
    assert.notEqual(sealed(), before);
  });

  test("login starts at github.com or a GitHub Enterprise server, with PKCE and state", async () => {
    const start = async (id: string) => {
      const res = await fetch(`${s.url}/api/auth/oauth/${id}/start?mode=login&next=/`, { redirect: "manual" });
      return { status: res.status, location: new URL(res.headers.get("location")!), cookie: res.headers.get("set-cookie") ?? "" };
    };
    const gh = await start("gh");
    assert.equal(gh.status, 302);
    assert.equal(gh.location.origin + gh.location.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(gh.location.searchParams.get("client_id"), "gh-client");
    assert.equal(gh.location.searchParams.get("redirect_uri"), `${s.config.publicUrl}/api/auth/oauth/gh/callback`);
    assert.equal(gh.location.searchParams.get("code_challenge_method"), "S256");
    assert.ok(gh.location.searchParams.get("state"));
    assert.match(gh.cookie, /awake_oauth=/);

    await s.admin.req("POST", "/admin/providers", { ...github, id: "ghe", issuer: "https://ghe.example.com" });
    const ghe = await start("ghe");
    assert.equal(ghe.location.origin + ghe.location.pathname, "https://ghe.example.com/login/oauth/authorize");

    const missing = await start("nope");
    assert.equal(missing.location.searchParams.get("error"), "PROVIDER_NOT_FOUND");
  });

  test("deleting a provider leaves accounts with no other login without access", async () => {
    // One account created by link (no password yet), one with a password, both linked to "gh".
    const linkOnly = (await s.admin.req("POST", "/admin/users", { username: "viagithub", credentials: { type: "link" } })).body.user;
    const withPassword = await createUser(s, "haspassword");
    const db = raw(s);
    const link = db.prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES ('gh', ?, ?, NULL, 0)");
    link.run("1001", linkOnly.id);
    link.run("1002", withPassword.id);
    db.close();

    const users = async () => Object.fromEntries((await s.admin.req("GET", "/admin/users")).body.map((u: any) => [u.username, u]));
    assert.equal((await users()).viagithub.canLogIn, true);
    assert.equal((await s.admin.req("GET", "/admin/providers")).body.find((p: any) => p.id === "gh").linkedUsers, 2);

    const res = await s.admin.req("DELETE", "/admin/providers/gh");
    assert.deepEqual(res.body.withoutLogin, ["viagithub"]);
    const after = await users();
    assert.equal(after.viagithub.canLogIn, false);
    assert.deepEqual(after.viagithub.providers, []);
    assert.equal(after.haspassword.canLogIn, true);

    // The admin's way out: a set-password link.
    assert.equal((await s.admin.req("POST", `/admin/users/${linkOnly.id}/password-link`)).status, 200);
  });
});

describe("without SECRET_KEY", () => {
  test("providers cannot be saved, the rest works", async () => {
    const s = await startTestServer({ secretKey: null });
    try {
      assert.equal((await s.admin.req("GET", "/admin/settings")).body.secretKeyConfigured, false);
      assert.equal((await s.admin.req("POST", "/admin/providers", github)).body.error, "SECRET_KEY_MISSING");
      assert.equal((await s.admin.req("GET", "/houses")).status, 200);
    } finally {
      await s.close();
    }
  });
});
