// /api/admin/settings and /api/admin/providers: server settings and login providers, edited by admins
// in the UI. Mounted inside adminRoutes, which already requires an admin session.
//
// Providers: any number, several of the same type. The id is chosen at creation and never changes
// (it is in the redirect URI and in linked identities). Client secrets are sealed with SECRET_KEY and
// never returned. Deleting a provider removes its linked identities; accounts left with no way to log
// in (no password, no other enabled provider) show up in the users list as "no login" until an admin
// sends them a set-password link.

import { Hono } from "hono";
import { providerInputSchema, serverSettingsSchema, type AdminProvider, type ProviderDeleted, type ServerSettings } from "@awake/shared";
import type { ProviderRow } from "../auth/oauth.ts";
import { isUniqueViolation, transaction } from "../db.ts";
import { ApiError } from "../errors.ts";
import { log } from "../log.ts";
import { seal } from "../secrets.ts";
import { getSettings, setSettings } from "../settings.ts";
import { readBody, type Env, type Services } from "./common.ts";

export function serverRoutes(s: Services) {
  const { db, config, oauth } = s;
  const app = new Hono<Env>();

  // ---------- settings ----------

  const settingsView = (): ServerSettings => ({ ...getSettings(db), secretKeyConfigured: !!config.secretKey });

  app.get("/settings", (c) => c.json(settingsView()));

  app.put("/settings", async (c) => {
    const body = await readBody(c, serverSettingsSchema);
    setSettings(db, body);
    log.info("admin", "settings updated", { by: c.var.auth.user.username, ...body });
    return c.json(settingsView());
  });

  // ---------- providers ----------

  const toProvider = (row: ProviderRow): AdminProvider => ({
    id: row.id,
    label: row.label,
    type: row.type,
    issuer: row.issuer,
    clientId: row.client_id,
    scopes: row.scopes,
    enabled: !!row.enabled,
    allowSignup: !!row.allow_signup,
    redirectUri: oauth.redirectUri(row.id),
    linkedUsers: (db.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider = ?").get(row.id) as { n: number }).n,
    createdAt: row.created_at,
  });

  const load = (id: string): ProviderRow => {
    const row = db.prepare("SELECT * FROM oauth_providers WHERE id = ?").get(id) as ProviderRow | undefined;
    if (!row) throw new ApiError(404, "NOT_FOUND");
    return row;
  };

  /** OIDC needs an issuer; GitHub takes an optional GitHub Enterprise base URL. */
  const checkIssuer = (input: { type: string; issuer: string | null }) => {
    if (input.type === "oidc" && !input.issuer) throw new ApiError(400, "VALIDATION", "issuer");
  };

  const sealSecret = (secret: string): string => {
    if (!config.secretKey) throw new ApiError(409, "SECRET_KEY_MISSING");
    return seal(secret, config.secretKey);
  };

  app.get("/providers", (c) => {
    const rows = db.prepare("SELECT * FROM oauth_providers ORDER BY label, id").all() as unknown as ProviderRow[];
    return c.json(rows.map(toProvider));
  });

  /** Checks an OIDC issuer before saving (discovery). Never contacts anything for GitHub. */
  app.post("/providers/test", async (c) => {
    const body = await readBody(c, providerInputSchema.pick({ type: true, issuer: true }));
    checkIssuer(body);
    await oauth.test(body.type, body.issuer);
    return c.body(null, 204);
  });

  app.post("/providers", async (c) => {
    const body = await readBody(c, providerInputSchema);
    if (!body.id) throw new ApiError(400, "VALIDATION", "id");
    if (!body.clientSecret) throw new ApiError(400, "VALIDATION", "clientSecret");
    checkIssuer(body);
    const secret = sealSecret(body.clientSecret);
    const now = Date.now();
    try {
      db.prepare(
        `INSERT INTO oauth_providers (id, label, type, issuer, client_id, client_secret_enc, scopes, enabled, allow_signup, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(body.id, body.label, body.type, body.issuer, body.clientId, secret, body.scopes, Number(body.enabled), Number(body.allowSignup), now, now);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, "PROVIDER_ID_TAKEN", "id");
      throw err;
    }
    log.info("admin", "provider created", { by: c.var.auth.user.username, provider: body.id, type: body.type });
    return c.json(toProvider(load(body.id)), 201);
  });

  /** Updates a provider; an empty client secret keeps the current one. The id cannot change. */
  app.put("/providers/:id", async (c) => {
    const row = load(c.req.param("id"));
    const body = await readBody(c, providerInputSchema);
    checkIssuer(body);
    const secret = body.clientSecret ? sealSecret(body.clientSecret) : row.client_secret_enc;
    db.prepare(
      `UPDATE oauth_providers SET label = ?, type = ?, issuer = ?, client_id = ?, client_secret_enc = ?, scopes = ?,
         enabled = ?, allow_signup = ?, updated_at = ? WHERE id = ?`,
    ).run(body.label, body.type, body.issuer, body.clientId, secret, body.scopes, Number(body.enabled), Number(body.allowSignup), Date.now(), row.id);
    oauth.forget(row.id);
    log.info("admin", "provider updated", { by: c.var.auth.user.username, provider: row.id, secretChanged: !!body.clientSecret });
    return c.json(toProvider(load(row.id)));
  });

  /** Deletes a provider and its linked identities; reports the accounts left without any login. */
  app.delete("/providers/:id", (c) => {
    const row = load(c.req.param("id"));
    const withoutLogin = transaction(db, () => {
      const linked = db.prepare("SELECT user_id FROM identities WHERE provider = ?").all(row.id) as { user_id: string }[];
      db.prepare("DELETE FROM identities WHERE provider = ?").run(row.id);
      db.prepare("DELETE FROM oauth_states WHERE provider = ?").run(row.id);
      db.prepare("DELETE FROM oauth_providers WHERE id = ?").run(row.id);
      const stranded: string[] = [];
      for (const { user_id } of linked) {
        const user = db
          .prepare(
            `SELECT u.username FROM users u WHERE u.id = ? AND u.password_hash IS NULL AND NOT EXISTS (
               SELECT 1 FROM identities i JOIN oauth_providers p ON p.id = i.provider WHERE i.user_id = u.id AND p.enabled = 1)`,
          )
          .get(user_id) as { username: string } | undefined;
        if (user) stranded.push(user.username);
      }
      return stranded;
    });
    oauth.forget(row.id);
    log.info("admin", "provider deleted", { by: c.var.auth.user.username, provider: row.id, withoutLogin: withoutLogin.length });
    return c.json({ withoutLogin } satisfies ProviderDeleted);
  });

  return app;
}
