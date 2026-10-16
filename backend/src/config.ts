// Configuration, read once from the environment at startup. Every variable is documented in .env.example.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.ts";

export interface Config {
  port: number;
  /**
   * Built web UI served as a SPA; a missing directory only disables the UI. Null with `--api-only`
   * (`make dev`), where Vite serves the UI and this server only answers the API.
   */
  webDir: string | null;
  /** Public origin users reach the server at (scheme + host, no trailing slash). Used for OAuth
   *  redirects, password links, cookie security and the Origin check on state-changing requests. */
  publicUrl: string;
  dataDir: string;
  trustProxy: boolean;
  registration: { enabled: boolean; autoApprove: boolean };
  providers: ProviderConfig[];
  /** Idle lifetime of a session; every use extends it. */
  sessionTtlMs: number;
  /** Lifetime of a set-password link. */
  passwordLinkTtlMs: number;
  timing: Timing;
}

export type ProviderType = "oidc" | "github";

export interface ProviderConfig {
  id: string;
  label: string;
  type: ProviderType;
  /** OIDC issuer (discovery at <issuer>/.well-known/openid-configuration). Unused for GitHub. */
  issuer: string | null;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

export interface Timing {
  /** Heartbeat interval announced to agents (seconds). */
  heartbeatSec: number;
  /** An agent silent for this long is disconnected. */
  agentIdleMs: number;
  /** Time a new connection has to send its hello. */
  helloTimeoutMs: number;
  /** Max wait for the ack of wake / press / set. */
  ackTimeoutMs: number;
  /** Timeout the agent applies to a single probe. */
  probeTimeoutMs: number;
  /** Max wait for a probe_result (probe timeout + network slack). */
  probeResultTimeoutMs: number;
  /** A completed check is reused for this long (dedupes concurrent UIs). */
  statusCacheMs: number;
  /** After a wake: check every probeIntervalMs until online or wakeWindowMs elapsed. */
  probeIntervalMs: number;
  wakeWindowMs: number;
}

export const defaultTiming: Timing = {
  heartbeatSec: 20,
  agentIdleMs: 65_000,
  helloTimeoutMs: 10_000,
  ackTimeoutMs: 5_000,
  probeTimeoutMs: 2_000,
  probeResultTimeoutMs: 5_000,
  statusCacheMs: 10_000,
  probeIntervalMs: 10_000,
  wakeWindowMs: 5 * 60_000,
};

/** Defaults for well-known providers: only the client id and secret are needed for these. */
const PRESETS: Record<string, Partial<ProviderConfig>> = {
  google: { label: "Google", type: "oidc", issuer: "https://accounts.google.com", scopes: "openid email profile" },
  github: { label: "GitHub", type: "github", scopes: "read:user user:email" },
};

export class ConfigError extends Error {}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = (env.PUBLIC_URL?.trim() || `http://localhost:${env.PORT ?? 8080}`).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(publicUrl);
  } catch {
    throw new ConfigError(`PUBLIC_URL is not a valid URL: ${publicUrl}`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new ConfigError("PUBLIC_URL must be an origin only (e.g. https://awake.example.com), without a path");
  }
  if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    log.warn("config", "PUBLIC_URL is plain http: serve Awake through an HTTPS reverse proxy when it is reachable from the internet");
  }

  return {
    port: int(env.PORT, 8080, "PORT"),
    // backend/src/config.ts or backend/dist/index.js -> frontend/dist
    webDir: path.resolve(env.WEB_DIR?.trim() || path.join(here, "../../frontend/dist")),
    publicUrl: parsed.origin,
    dataDir: path.resolve(env.DATA_DIR?.trim() || "./data"),
    trustProxy: bool(env.TRUST_PROXY, false),
    registration: {
      enabled: bool(env.REGISTRATION_ENABLED, false),
      autoApprove: bool(env.REGISTRATION_AUTO_APPROVE, false),
    },
    providers: loadProviders(env),
    sessionTtlMs: int(env.SESSION_TTL_DAYS, 30, "SESSION_TTL_DAYS") * 86_400_000,
    passwordLinkTtlMs: int(env.PASSWORD_LINK_TTL_HOURS, 72, "PASSWORD_LINK_TTL_HOURS") * 3_600_000,
    timing: defaultTiming,
  };
}

/** OAUTH_PROVIDERS=google,github,authentik then OAUTH_<ID>_* for each (see .env.example). */
function loadProviders(env: NodeJS.ProcessEnv): ProviderConfig[] {
  const ids = (env.OAUTH_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: ProviderConfig[] = [];
  for (const id of new Set(ids)) {
    if (!/^[a-z0-9-]{1,32}$/.test(id)) throw new ConfigError(`OAUTH_PROVIDERS: invalid provider id "${id}"`);
    const key = (name: string) => env[`OAUTH_${id.toUpperCase().replace(/-/g, "_")}_${name}`]?.trim() || undefined;
    const preset = PRESETS[id] ?? {};
    const type = (key("TYPE") ?? preset.type ?? "oidc") as ProviderType;
    if (type !== "oidc" && type !== "github") throw new ConfigError(`OAUTH_${id.toUpperCase()}_TYPE must be oidc or github`);
    const issuer = key("ISSUER") ?? preset.issuer ?? null;
    if (type === "oidc" && !issuer) throw new ConfigError(`OAUTH_${id.toUpperCase()}_ISSUER is required for an OIDC provider`);
    const clientId = key("CLIENT_ID");
    const clientSecret = key("CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new ConfigError(`OAUTH_${id.toUpperCase()}_CLIENT_ID and OAUTH_${id.toUpperCase()}_CLIENT_SECRET are required`);
    }
    out.push({
      id,
      label: key("LABEL") ?? preset.label ?? id,
      type,
      issuer,
      clientId,
      clientSecret,
      scopes: key("SCOPES") ?? preset.scopes ?? "openid email profile",
    });
  }
  return out;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} must be a non-negative integer`);
  return n;
}
