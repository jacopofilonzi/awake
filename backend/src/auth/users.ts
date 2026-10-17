// Users: rows, API views, creation, set-password links and the bootstrap admin.

import type { AdminUser, Identity, Me, PasswordLink, User, UserStatus } from "@awake/shared";
import { USERNAME_RE } from "@awake/shared";
import type { Config } from "../config.ts";
import { isUniqueViolation, newId, type Db } from "../db.ts";
import { ApiError } from "../errors.ts";
import { generatePassword, hashPassword, hashToken, randomToken } from "../secrets.ts";

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  is_admin: number;
  status: UserStatus;
  must_change_password: number;
  created_at: number;
  last_login_at: number | null;
}

export function loadUser(db: Db, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function loadUserByName(db: Db, username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim().toLowerCase()) as UserRow | undefined;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    admin: !!row.is_admin,
    mustChangePassword: !!row.must_change_password,
    hasPassword: !!row.password_hash,
  };
}

export function toMe(db: Db, row: UserRow, providerLabel: (id: string) => string): Me {
  const identities = db
    .prepare("SELECT provider, email, created_at FROM identities WHERE user_id = ? ORDER BY created_at")
    .all(row.id) as { provider: string; email: string | null; created_at: number }[];
  return {
    user: toUser(row),
    identities: identities.map(
      (i): Identity => ({ provider: i.provider, providerLabel: providerLabel(i.provider), email: i.email, createdAt: i.created_at }),
    ),
  };
}

export function toAdminUser(db: Db, row: UserRow): AdminUser {
  const providers = db
    .prepare(
      `SELECT i.provider, COALESCE(p.enabled, 0) AS enabled FROM identities i
       LEFT JOIN oauth_providers p ON p.id = i.provider WHERE i.user_id = ? ORDER BY i.provider`,
    )
    .all(row.id) as { provider: string; enabled: number }[];
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    admin: !!row.is_admin,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
    hasPassword: !!row.password_hash,
    providers: providers.map((p) => p.provider),
    canLogIn: !!row.password_hash || providers.some((p) => p.enabled),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function createUser(
  db: Db,
  input: { username: string; email?: string | null; passwordHash: string | null; admin: boolean; status: UserStatus; mustChangePassword: boolean },
): UserRow {
  const id = newId();
  try {
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, is_admin, status, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.username,
      input.email ?? null,
      input.passwordHash,
      Number(input.admin),
      input.status,
      Number(input.mustChangePassword),
      Date.now(),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "USERNAME_TAKEN", "username");
    throw err;
  }
  return loadUser(db, id)!;
}

/** Turns a provider's login / email / name into a free, valid username (`mario`, `mario-2`…). */
export function availableUsername(db: Db, hint: string | null | undefined): string {
  let base = (hint ?? "")
    .split("@")[0]!
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 28);
  if (base.length < 3) base = `user${base}`;
  if (!USERNAME_RE.test(base)) base = "user";
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!loadUserByName(db, candidate)) return candidate;
  }
}

/** Creates a one-time set-password link for a user (invite or reset). Previous links stop working. */
export function issuePasswordLink(db: Db, config: Config, userId: string, createdBy: string | null): PasswordLink {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + config.passwordLinkTtlMs;
  db.prepare("DELETE FROM password_tokens WHERE user_id = ?").run(userId);
  db.prepare("INSERT INTO password_tokens (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    createdBy,
    now,
    expiresAt,
  );
  // In the fragment: it never reaches server logs, proxies or Referer headers.
  return { url: `${config.publicUrl}/set-password#${token}`, expiresAt };
}

export function countActiveAdmins(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND status = 'active'").get() as { n: number }).n;
}

/**
 * On an empty database, creates `admin` with a random password that must be changed at first login.
 * Returns the password (to print once in the logs), or null when users already exist.
 */
export async function bootstrapAdmin(db: Db): Promise<string | null> {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (n > 0) return null;
  const password = generatePassword();
  createUser(db, { username: "admin", passwordHash: await hashPassword(password), admin: true, status: "active", mustChangePassword: true });
  return password;
}

/** CLI recovery: sets a new random password (to be changed at next login) and re-enables the user. */
export async function resetPassword(db: Db, username: string): Promise<string> {
  const user = loadUserByName(db, username);
  if (!user) throw new Error(`no user named "${username}"`);
  const password = generatePassword();
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, status = 'active' WHERE id = ?").run(
    await hashPassword(password),
    user.id,
  );
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  return password;
}
