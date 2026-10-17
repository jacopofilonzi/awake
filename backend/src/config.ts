// Configuration, read once from the environment at startup. Every variable is documented in .env.example.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { INFO_MIN_INTERVAL_MS } from "./agents/protocol.ts";
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
  /** Lowercase name of the header carrying the client IP when trustProxy is set (see clientip.ts). */
  clientIpHeader: string;
  /**
   * Encrypts the client secrets of login providers stored in the database. Null: providers cannot be
   * saved (the rest of the server works). Login providers and registration are configured by admins
   * in the UI, not here.
   */
  secretKey: string | null;
  /** Idle lifetime of a session; every use extends it. */
  sessionTtlMs: number;
  /** Lifetime of a set-password link. */
  passwordLinkTtlMs: number;
  timing: Timing;
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
  /** An `info` message closer than this to the previous one (hello included) is ignored. */
  infoMinIntervalMs: number;
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
  infoMinIntervalMs: INFO_MIN_INTERVAL_MS,
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
    clientIpHeader: clientIpHeader(env),
    secretKey: loadSecretKey(env),
    sessionTtlMs: int(env.SESSION_TTL_DAYS, 30, "SESSION_TTL_DAYS") * 86_400_000,
    passwordLinkTtlMs: int(env.PASSWORD_LINK_TTL_HOURS, 72, "PASSWORD_LINK_TTL_HOURS") * 3_600_000,
    timing: defaultTiming,
  };
}

function clientIpHeader(env: NodeJS.ProcessEnv): string {
  const name = env.CLIENT_IP_HEADER?.trim();
  if (!name) return "x-forwarded-for";
  if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) throw new ConfigError("CLIENT_IP_HEADER must be a header name, e.g. CF-Connecting-IP");
  if (!bool(env.TRUST_PROXY, false)) log.warn("config", "CLIENT_IP_HEADER is ignored without TRUST_PROXY=true");
  return name.toLowerCase();
}

function loadSecretKey(env: NodeJS.ProcessEnv): string | null {
  const key = env.SECRET_KEY?.trim();
  if (!key) {
    log.warn("config", "SECRET_KEY is not set: login providers cannot be configured (see .env.example)");
    return null;
  }
  if (key.length < 32) throw new ConfigError("SECRET_KEY must be at least 32 characters (e.g. openssl rand -base64 32)");
  return key;
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
