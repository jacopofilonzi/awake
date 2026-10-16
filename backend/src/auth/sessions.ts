// Browser sessions: an opaque random token in an HttpOnly cookie; the database stores only its hash.
// Sessions slide: each use extends them by the configured TTL. Cookies are `SameSite=Lax` and, when
// PUBLIC_URL is https, `Secure` with the `__Host-` prefix (bound to this exact host, path /).

import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { hashToken, randomToken } from "../secrets.ts";
import type { UserRow } from "./users.ts";

/** Session refreshes are written at most this often, not on every request. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

export function isSecure(config: Config): boolean {
  return config.publicUrl.startsWith("https://");
}

export function sessionCookieName(config: Config): string {
  return isSecure(config) ? "__Host-awake_session" : "awake_session";
}

export function createSession(db: Db, config: Config, c: Context, userId: string, ip: string): void {
  const token = randomToken();
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(hashToken(token), userId, now, now, now + config.sessionTtlMs, ip, (c.req.header("user-agent") ?? "").slice(0, 256));
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, userId);
  setCookie(c, sessionCookieName(config), token, {
    httpOnly: true,
    secure: isSecure(config),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export interface SessionInfo {
  user: UserRow;
  sessionHash: string;
}

/** The session of the request, if valid; expired sessions are deleted. */
export function readSession(db: Db, config: Config, c: Context): SessionInfo | null {
  const token = getCookie(c, sessionCookieName(config));
  if (!token) return null;
  const hash = hashToken(token);
  const row = db.prepare("SELECT user_id, last_seen_at, expires_at FROM sessions WHERE id_hash = ?").get(hash) as
    | { user_id: string; last_seen_at: number; expires_at: number }
    | undefined;
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash);
    return null;
  }
  if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?").run(now, now + config.sessionTtlMs, hash);
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) as UserRow | undefined;
  return user ? { user, sessionHash: hash } : null;
}

export function endSession(db: Db, config: Config, c: Context, sessionHash: string): void {
  db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(sessionHash);
  deleteCookie(c, sessionCookieName(config), { path: "/", secure: isSecure(config) });
}

/** Revokes every session of a user, except optionally the current one. */
export function revokeSessions(db: Db, userId: string, exceptHash?: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?").run(userId, exceptHash ?? "");
}

export function purgeExpired(db: Db): void {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM password_tokens WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(now);
}
