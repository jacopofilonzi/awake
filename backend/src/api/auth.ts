// /api/auth: password login, registration, logout, own profile and password, set-password links,
// external providers (login and linking).

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { passwordSchema, usernameSchema, type ErrorCode, type PasswordTokenInfo, type RegisterResponse } from "@awake/shared";
import type { Provider } from "../auth/oauth.ts";
import { createSession, endSession, isSecure, readSession, revokeSessions } from "../auth/sessions.ts";
import { availableUsername, createUser, loadUser, loadUserByName, toMe, type UserRow } from "../auth/users.ts";
import { isUniqueViolation } from "../db.ts";
import { ApiError } from "../errors.ts";
import { log } from "../log.ts";
import { getSettings } from "../settings.ts";
import { dummyPasswordHash, hashPassword, hashToken, verifyPassword } from "../secrets.ts";
import { readBody, requestIp, requireUser, type Ctx, type Env, type Services } from "./common.ts";

const OAUTH_COOKIE = "awake_oauth";
const OAUTH_STATE_TTL_MS = 10 * 60_000;

export function authRoutes(s: Services) {
  const { db, config, limiters, oauth, bus } = s;
  const app = new Hono<Env>();
  const me = (row: UserRow) => toMe(db, row, (id) => oauth.label(id));

  /** Rejects when the IP is over its failure budget. */
  const guard = (c: Ctx, username?: string) => {
    const ip = requestIp(c, config);
    if (limiters.ip.isBlocked(ip) || (username && limiters.username.isBlocked(username))) throw new ApiError(429, "RATE_LIMITED");
    return ip;
  };

  app.post("/login", async (c) => {
    const body = await readBody(c, z.object({ username: z.string().max(64), password: z.string().max(1024) }));
    const username = body.username.trim().toLowerCase();
    const ip = guard(c, username);

    const user = loadUserByName(db, username);
    // Same work whether or not the user exists, so timing does not reveal usernames.
    const valid = await verifyPassword(body.password, user?.password_hash ?? (await dummyPasswordHash()));
    if (!user || !user.password_hash || !valid) {
      limiters.ip.recordFailure(ip);
      limiters.username.recordFailure(username);
      throw new ApiError(401, "INVALID_CREDENTIALS");
    }
    if (user.status === "pending") throw new ApiError(403, "ACCOUNT_PENDING");
    if (user.status === "disabled") throw new ApiError(403, "ACCOUNT_DISABLED");

    createSession(db, config, c, user.id, ip);
    log.info("auth", "login", { user: user.username, ip });
    return c.json(me(user));
  });

  app.post("/register", async (c) => {
    const settings = getSettings(db);
    if (!settings.registrationEnabled) throw new ApiError(403, "REGISTRATION_DISABLED");
    const ip = guard(c);
    const body = await readBody(c, z.object({ username: usernameSchema, password: passwordSchema }));
    // Every attempt counts, successful or not: registration must not be scriptable at volume.
    limiters.ip.recordFailure(ip);

    const status = settings.autoApprove ? "active" : "pending";
    const user = createUser(db, {
      username: body.username,
      passwordHash: await hashPassword(body.password),
      admin: false,
      status,
      mustChangePassword: false,
    });
    log.info("auth", "registered", { user: user.username, status, ip });
    if (status === "pending") return c.json({ status } satisfies RegisterResponse, 202);
    createSession(db, config, c, user.id, ip);
    return c.json({ status, me: me(user) } satisfies RegisterResponse, 201);
  });

  app.post("/logout", requireUser(s), (c) => {
    endSession(db, config, c, c.var.auth.sessionHash);
    return c.body(null, 204);
  });

  app.get("/me", requireUser(s), (c) => c.json(me(c.var.auth.user)));

  /** Changes the own password. The current one is required when the account has one. */
  app.post("/password", requireUser(s), async (c) => {
    const { user, sessionHash } = c.var.auth;
    const body = await readBody(c, z.object({ currentPassword: z.string().max(1024).optional(), newPassword: passwordSchema }));
    const ip = guard(c);
    if (user.password_hash && !(await verifyPassword(body.currentPassword ?? "", user.password_hash))) {
      limiters.ip.recordFailure(ip);
      throw new ApiError(400, "WRONG_PASSWORD", "currentPassword");
    }
    if (body.currentPassword === body.newPassword) throw new ApiError(400, "INVALID_PASSWORD", "newPassword");
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(await hashPassword(body.newPassword), user.id);
    // Other devices must log in again with the new password.
    revokeSessions(db, user.id, sessionHash);
    return c.json(me(loadUser(db, user.id)!));
  });

  // ---------- set-password links ----------

  const tokenRow = (token: string) => {
    const row = db
      .prepare("SELECT t.user_id, t.expires_at, u.username FROM password_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?")
      .get(hashToken(token)) as { user_id: string; expires_at: number; username: string } | undefined;
    return row && row.expires_at > Date.now() ? row : null;
  };

  /** Lets the set-password page show whose password is being set. */
  app.post("/password-link/inspect", async (c) => {
    const ip = guard(c);
    const { token } = await readBody(c, z.object({ token: z.string().max(128) }));
    const row = tokenRow(token);
    if (!row) {
      limiters.ip.recordFailure(ip);
      throw new ApiError(400, "INVALID_TOKEN");
    }
    return c.json({ username: row.username, expiresAt: row.expires_at } satisfies PasswordTokenInfo);
  });

  app.post("/password-link", async (c) => {
    const ip = guard(c);
    const body = await readBody(c, z.object({ token: z.string().max(128), password: passwordSchema }));
    const row = tokenRow(body.token);
    if (!row) {
      limiters.ip.recordFailure(ip);
      throw new ApiError(400, "INVALID_TOKEN");
    }
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(await hashPassword(body.password), row.user_id);
    db.prepare("DELETE FROM password_tokens WHERE user_id = ?").run(row.user_id);
    revokeSessions(db, row.user_id);
    bus.closeUser(row.user_id);
    log.info("auth", "password set through link", { user: row.username, ip });
    return c.body(null, 204);
  });

  // ---------- external providers ----------

  app.delete("/identities/:provider", requireUser(s), (c) => {
    const { user } = c.var.auth;
    const provider = c.req.param("provider");
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM identities WHERE user_id = ?").get(user.id) as { n: number };
    const linked = db.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider = ?").get(user.id, provider);
    if (!linked) throw new ApiError(404, "NOT_FOUND");
    if (!user.password_hash && n <= 1) throw new ApiError(409, "LAST_LOGIN_METHOD");
    db.prepare("DELETE FROM identities WHERE user_id = ? AND provider = ?").run(user.id, provider);
    return c.json(me(user));
  });

  /** Starts a login (`mode=login`) or links the provider to the logged-in account (`mode=link`). */
  app.get("/oauth/:provider/start", async (c) => {
    const mode = c.req.query("mode") === "link" ? "link" : "login";
    const next = safeNext(c.req.query("next"));
    const provider = providerOrError(c.req.param("provider"));
    if ("error" in provider) return redirectError(c, next, provider.error);
    let userId: string | null = null;
    if (mode === "link") {
      const session = readSession(db, config, c);
      if (!session || session.user.status !== "active" || session.user.must_change_password) return redirectError(c, next, "UNAUTHORIZED");
      userId = session.user.id;
    }

    const secrets = oauth.newSecrets();
    let url: URL;
    try {
      url = await oauth.authorizationUrl(provider, secrets);
    } catch (err) {
      log.warn("oauth", "cannot start login", { provider: provider.id, err });
      return redirectError(c, next, "OAUTH_FAILED");
    }
    db.prepare(
      "INSERT INTO oauth_states (state_hash, provider, code_verifier, nonce, mode, user_id, next, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(hashToken(secrets.state), provider.id, secrets.codeVerifier, secrets.nonce, mode, userId, next, Date.now() + OAUTH_STATE_TTL_MS);
    // Binds the flow to this browser: a callback URL forwarded to someone else cannot log them in.
    setCookie(c, OAUTH_COOKIE, secrets.state, {
      httpOnly: true,
      secure: isSecure(config),
      sameSite: "Lax",
      path: "/api/auth/oauth",
      maxAge: OAUTH_STATE_TTL_MS / 1000,
    });
    return c.redirect(url.href, 302);
  });

  app.get("/oauth/:provider/callback", async (c) => {
    const provider = providerOrError(c.req.param("provider"));
    if ("error" in provider) return redirectError(c, "/", provider.error);
    const state = c.req.query("state") ?? "";
    const cookieState = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: "/api/auth/oauth", secure: isSecure(config) });

    const flow = state
      ? (db.prepare("SELECT * FROM oauth_states WHERE state_hash = ?").get(hashToken(state)) as
          | { provider: string; code_verifier: string; nonce: string; mode: "login" | "link"; user_id: string | null; next: string; expires_at: number }
          | undefined)
      : undefined;
    if (flow) db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").run(hashToken(state));
    if (!flow || flow.provider !== provider.id || flow.expires_at < Date.now() || cookieState !== state) {
      return redirectError(c, "/", "OAUTH_FAILED");
    }

    let identity;
    try {
      const callbackUrl = new URL(`${config.publicUrl}${c.req.path}${new URL(c.req.url).search}`);
      identity = await oauth.complete(provider, callbackUrl, { state, nonce: flow.nonce, codeVerifier: flow.code_verifier });
    } catch (err) {
      log.warn("oauth", "login failed", { provider: provider.id, err });
      return redirectError(c, flow.next, "OAUTH_FAILED");
    }

    const linkedUserId = (
      db.prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").get(provider.id, identity.subject) as
        | { user_id: string }
        | undefined
    )?.user_id;

    if (flow.mode === "link") {
      // The session must still be the one that started the flow.
      const session = readSession(db, config, c);
      if (!session || session.user.id !== flow.user_id) return redirectError(c, flow.next, "UNAUTHORIZED");
      if (linkedUserId && linkedUserId !== session.user.id) return redirectError(c, flow.next, "IDENTITY_IN_USE");
      if (!linkedUserId) {
        try {
          db.prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)").run(
            provider.id,
            identity.subject,
            session.user.id,
            identity.email,
            Date.now(),
          );
        } catch (err) {
          // One identity per provider and user: linking a second account of the same provider.
          if (isUniqueViolation(err)) return redirectError(c, flow.next, "IDENTITY_IN_USE");
          throw err;
        }
      }
      return c.redirect(withParam(flow.next, "linked", provider.id), 302);
    }

    const ip = requestIp(c, config);
    let user = linkedUserId ? loadUser(db, linkedUserId) : undefined;
    if (!user) {
      // Accounts are never matched by email: an unknown identity is linked from an existing account
      // (Account → linked logins), or becomes a new account only when this provider allows it.
      if (!provider.allowSignup) return redirectError(c, flow.next, "OAUTH_NOT_LINKED");
      const status = getSettings(db).autoApprove ? "active" : "pending";
      user = createUser(db, {
        username: availableUsername(db, identity.usernameHint),
        email: identity.email,
        passwordHash: null,
        admin: false,
        status,
        mustChangePassword: false,
      });
      db.prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)").run(
        provider.id,
        identity.subject,
        user.id,
        identity.email,
        Date.now(),
      );
      log.info("auth", "registered through provider", { user: user.username, provider: provider.id, status, ip });
    }
    if (user.status === "pending") return redirectError(c, flow.next, "ACCOUNT_PENDING");
    if (user.status === "disabled") return redirectError(c, flow.next, "ACCOUNT_DISABLED");

    createSession(db, config, c, user.id, ip);
    log.info("auth", "login", { user: user.username, provider: provider.id, ip });
    return c.redirect(`${config.publicUrl}${flow.next}`, 302);
  });

  /** OAuth routes are browser navigations: errors become a redirect with `?error=`, not JSON. */
  function providerOrError(id: string): Provider | { error: ErrorCode } {
    try {
      return oauth.get(id);
    } catch (err) {
      if (err instanceof ApiError) return { error: err.code };
      throw err;
    }
  }

  function redirectError(c: Ctx, next: string, code: ErrorCode) {
    return c.redirect(withParam(next, "error", code), 302);
  }

  function withParam(next: string, key: string, value: string): string {
    const url = new URL(next, config.publicUrl);
    url.searchParams.set(key, value);
    return url.href;
  }

  return app;
}

/** Only same-site absolute paths: never `//host` or a full URL (open redirect). */
function safeNext(next: string | undefined): string {
  return next && next.length < 512 && /^\/(?![/\\])/.test(next) ? next : "/";
}
