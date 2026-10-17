// Server-wide settings edited by admins in the UI, stored in the `settings` table (key → JSON value).

import type { Db } from "./db.ts";

export interface Settings {
  /** Anyone can sign up with username and password. */
  registrationEnabled: boolean;
  /** New accounts (password sign-up, or a provider allowing new accounts) are active without approval. */
  autoApprove: boolean;
}

const DEFAULTS: Settings = { registrationEnabled: false, autoApprove: false };

export function getSettings(db: Db): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out: Settings = { ...DEFAULTS };
  for (const { key, value } of rows) {
    if (key in DEFAULTS) (out as unknown as Record<string, unknown>)[key] = JSON.parse(value);
  }
  return out;
}

export function setSettings(db: Db, patch: Partial<Settings>): Settings {
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  for (const [key, value] of Object.entries(patch)) {
    if (key in DEFAULTS && value !== undefined) upsert.run(key, JSON.stringify(value));
  }
  return getSettings(db);
}
