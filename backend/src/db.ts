// SQLite database: schema migrations, backup before migrating, small helpers.
//
// Migrations are append-only: never edit one that has been released (pushed to main). Each entry's
// index + 1 is the `user_version` it produces. Before migrating an existing database, a copy is made
// next to it (`awake.db.bak-v<from>-<timestamp>`); if that fails the server refuses to start.
//
// Layout:
// - users / identities (external logins) / sessions / password_tokens (set-password links) /
//   oauth_states (pending OAuth redirects)
// - houses, with house_members (role owner|editor|member)
// - agents (per house) and agent_outputs (as last declared by the agent in its hello)
// - devices (per house): kind 'wol' (mac + device_agents) or 'output' (agent_id + output_id)
// - device_shares: a device shared directly with a user (use only)
// - action_log: every action, with its outcome
// Secrets (sessions, tokens, passwords) are stored only as hashes.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { log } from "./log.ts";

const migrations = [
  `
  CREATE TABLE users (
    id                   TEXT PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE,
    email                TEXT,
    password_hash        TEXT,
    is_admin             INTEGER NOT NULL DEFAULT 0,
    status               TEXT NOT NULL CHECK (status IN ('active', 'pending', 'disabled')),
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL,
    last_login_at        INTEGER
  );

  CREATE TABLE identities (
    provider   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email      TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id, provider)
  );

  CREATE TABLE sessions (
    id_hash      TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    ip           TEXT,
    user_agent   TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE password_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX password_tokens_user ON password_tokens(user_id);

  CREATE TABLE oauth_states (
    state_hash    TEXT PRIMARY KEY,
    provider      TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    nonce         TEXT NOT NULL,
    mode          TEXT NOT NULL CHECK (mode IN ('login', 'link')),
    user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
    next          TEXT NOT NULL,
    expires_at    INTEGER NOT NULL
  );

  CREATE TABLE houses (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE house_members (
    house_id   TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'member')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (house_id, user_id)
  );
  CREATE INDEX house_members_user ON house_members(user_id);

  CREATE TABLE agents (
    id         TEXT PRIMARY KEY,
    house_id   TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    firmware   TEXT,
    last_seen  INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX agents_house ON agents(house_id);

  CREATE TABLE agent_outputs (
    agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    output_id  TEXT NOT NULL,
    mode       TEXT NOT NULL CHECK (mode IN ('button', 'switch')),
    has_long   INTEGER NOT NULL DEFAULT 0,
    is_on      INTEGER,
    changed_at INTEGER,
    -- 0 when the agent's last hello no longer declared it: kept so bound devices know its mode.
    present    INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (agent_id, output_id)
  );

  CREATE TABLE devices (
    id         TEXT PRIMARY KEY,
    house_id   TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('wol', 'output')),
    mac        TEXT,
    agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
    output_id  TEXT,
    ip         TEXT,
    probe_port INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE (agent_id, output_id)
  );
  CREATE INDEX devices_house ON devices(house_id);

  CREATE TABLE device_agents (
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    PRIMARY KEY (device_id, agent_id)
  );
  CREATE INDEX device_agents_agent ON device_agents(agent_id);

  CREATE TABLE device_shares (
    device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (device_id, user_id)
  );
  CREATE INDEX device_shares_user ON device_shares(user_id);

  CREATE TABLE action_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id       TEXT REFERENCES devices(id) ON DELETE SET NULL,
    device_name     TEXT NOT NULL,
    house_id        TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
    house_name      TEXT NOT NULL,
    actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_username  TEXT,
    source          TEXT NOT NULL CHECK (source IN ('user', 'agent')),
    action          TEXT NOT NULL,
    outcome         TEXT NOT NULL,
    online_after_ms INTEGER,
    results         TEXT,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX action_log_house ON action_log(house_id, created_at DESC);
  CREATE INDEX action_log_actor ON action_log(actor_user_id, created_at DESC);
  `,
  // 2: login providers and server settings move from .env to the database (edited by admins).
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE oauth_providers (
    id                TEXT PRIMARY KEY,
    label             TEXT NOT NULL,
    type              TEXT NOT NULL CHECK (type IN ('oidc', 'github')),
    -- oidc: issuer URL; github: GitHub Enterprise base URL, NULL for github.com
    issuer            TEXT,
    client_id         TEXT NOT NULL,
    -- encrypted with SECRET_KEY (secrets.ts: seal/open)
    client_secret_enc TEXT NOT NULL,
    scopes            TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1,
    allow_signup      INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  `,
];

export type Db = DatabaseSync;

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "awake.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (current > migrations.length) {
    db.close();
    throw new Error(`database version ${current} is newer than this server (${migrations.length}): upgrade Awake`);
  }
  if (current > 0 && current < migrations.length) {
    const backup = `${file}.bak-v${current}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    } catch (err) {
      db.close();
      throw new Error(`could not back up the database before migrating, refusing to start: ${(err as Error).message}`);
    }
    log.info("db", "backed up before migrating", { backup, from: current, to: migrations.length });
  }
  for (let v = current; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}

export function newId(): string {
  return crypto.randomUUID();
}
