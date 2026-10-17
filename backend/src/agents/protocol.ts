// Agent <-> server messages, mirroring docs/PROTOCOL.md (the normative contract: agents share no code
// with the server). Change both together.

import { AGENT_RESET_REASONS, IPV4_RE, OUTPUT_ID_RE, type AgentInfo, type AgentResetReason } from "@awake/shared";

export const MAX_MESSAGE_BYTES = 8 * 1024;
export const MAX_OUTPUTS = 32;

export const CloseCode = {
  Normal: 1000,
  ServerShutdown: 1001, // server is restarting: reconnect with backoff
  ProtocolError: 4000, // malformed or unexpected message, invalid outputs
  AuthFailed: 4001, // unknown token
  Replaced: 4002, // another connection authenticated with the same token
  Revoked: 4003, // token regenerated or agent deleted
  UnsupportedVersion: 4004, // protocol version not supported by the server
  HelloTimeout: 4008, // no hello received in time
  RateLimited: 4029, // too many failed attempts from this IP
} as const;

export type HelloOutput = { id: string; mode: "button"; long: boolean } | { id: string; mode: "switch"; on: boolean };

export type AgentToServer =
  | { t: "hello"; v: number; token: string; fw?: string; outputs?: unknown; info?: unknown }
  | ({ t: "info" } & Record<string, unknown>)
  | { t: "hb" }
  | { t: "ack"; id: string; ok: boolean; err?: string; on?: boolean }
  | { t: "probe_result"; id: string; up: boolean; ms?: number; err?: string }
  | { t: "out_state"; out: string; on: boolean };

export type ServerToAgent =
  | { t: "welcome"; v: number; name: string; hb: number }
  | { t: "hb" }
  | { t: "wake"; id: string; mac: string }
  | { t: "probe"; id: string; ip: string; port?: number; timeout: number }
  | { t: "press"; id: string; out: string; long?: true }
  | { t: "set"; id: string; out: string; on: boolean };

/** Validates the `outputs` of a hello; null when invalid (the whole hello is then rejected). */
export function parseOutputs(raw: unknown): HelloOutput[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_OUTPUTS) return null;
  const seen = new Set<string>();
  const out: HelloOutput[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") return null;
    const { id, mode, long, on } = o as Record<string, unknown>;
    if (typeof id !== "string" || !OUTPUT_ID_RE.test(id) || seen.has(id)) return null;
    seen.add(id);
    if (mode === "button") {
      if (long !== undefined && typeof long !== "boolean") return null;
      out.push({ id, mode, long: long === true });
    } else if (mode === "switch") {
      if (typeof on !== "boolean") return null;
      out.push({ id, mode, on });
    } else {
      return null;
    }
  }
  return out;
}

export function parseMessage(text: string): AgentToServer | null {
  try {
    const msg = JSON.parse(text);
    return msg && typeof msg === "object" && !Array.isArray(msg) && typeof msg.t === "string" ? msg : null;
  } catch {
    return null;
  }
}

/** Minimum interval between two `info` messages; earlier ones are ignored (PROTOCOL.md §5.2). */
export const INFO_MIN_INTERVAL_MS = 60_000;

const shortString = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : undefined;
const intIn = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;

/**
 * The valid fields of an `info` object (from `hello.info` or an `info` message, whose `t` is ignored).
 * Lenient: invalid fields are dropped one by one, never the whole object; null when nothing is valid.
 */
export function parseInfo(raw: unknown): AgentInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const info: AgentInfo = {
    platform: shortString(r.platform, 64),
    host: shortString(r.host, 64),
    ip: typeof r.ip === "string" && IPV4_RE.test(r.ip) ? r.ip : undefined,
    ssid: shortString(r.ssid, 32),
    rssi: intIn(r.rssi, -120, 0),
    uptime: intIn(r.uptime, 0, 10 * 365 * 86400),
    reset: AGENT_RESET_REASONS.includes(r.reset as AgentResetReason) ? (r.reset as AgentResetReason) : undefined,
    mem: intIn(r.mem, 0, 2 ** 40),
  };
  for (const k of Object.keys(info) as (keyof AgentInfo)[]) if (info[k] === undefined) delete info[k];
  return Object.keys(info).length ? info : null;
}
