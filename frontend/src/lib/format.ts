// Presentation helpers shared by pages: device status, icons, relative times.

import type { Device, LogEntry } from "@awake/shared";
import type { IconName } from "./icons.ts";
import { i18n, t, type Key } from "./i18n/index.svelte.ts";

export type Tone = "ok" | "off" | "warn" | "error" | "unknown";

/** The single status shown for a device: switch state for switches, reachability otherwise. */
export function deviceState(d: Device): { tone: Tone; label: string } {
  const s = d.status;
  if (s.reach.state === "waking") return { tone: "warn", label: t("status.waking") };
  if (d.kind === "output" && !s.output) return { tone: "error", label: t("status.unbound") };
  if (s.output && !s.output.available) return { tone: "error", label: t("status.agentOffline") };
  if (s.output?.mode === "switch" && s.output.on !== null) return s.output.on ? { tone: "ok", label: t("status.on") } : { tone: "off", label: t("status.off") };
  if (s.reach.state === "online") return { tone: "ok", label: t("status.online") };
  if (s.reach.state === "offline") return { tone: "off", label: t("status.offline") };
  if (d.kind === "wol" && !s.ready) return { tone: "error", label: t("status.agentOffline") };
  const reason = s.reach.state === "unknown" ? s.reach.reason : "not_checked";
  return { tone: "unknown", label: t(`status.unknown.${reason}` as Key) };
}

export function deviceIcon(d: Device): IconName {
  if (d.kind === "wol") return "computer";
  return d.status.output?.mode === "switch" ? "toggle" : "power";
}

export function deviceKind(d: Device): string {
  if (d.kind === "wol") return t("device.kind.wol");
  if (d.status.output?.mode === "switch") return t("device.kind.switch");
  return t("device.kind.button");
}

export function relativeTime(ms: number | null): string {
  if (!ms) return "—";
  const diff = (ms - Date.now()) / 1000;
  const fmt = new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 45) return t("common.justNow");
  if (abs < 3600) return fmt.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return fmt.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return fmt.format(Math.round(diff / 86400), "day");
  return new Date(ms).toLocaleDateString(i18n.locale, { day: "numeric", month: "short" });
}

export function clock(ms: number): string {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString(i18n.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function logLine(e: LogEntry): { action: string; who: string; outcome: { tone: Tone; label: string } } {
  const action = t(`log.action.${e.action}` as Key);
  const who = e.source === "agent" ? t("log.byAgent") : e.actor ? e.actor.username : t("log.deletedUser");
  const tone: Tone = e.outcome === "online" || e.outcome === "ok" ? "ok" : e.outcome === "waking" ? "warn" : e.outcome === "failed" || e.outcome === "timeout" ? "error" : "off";
  const label =
    e.outcome === "online" && e.onlineAfterMs !== null
      ? t("log.outcome.onlineAfter", { s: Math.round(e.onlineAfterMs / 1000) })
      : t(`log.outcome.${e.outcome}` as Key);
  return { action, who, outcome: { tone, label } };
}

/** Whether a device counts as on (reachable, or a switch that is on): it lights up in the UI. */
export function isLit(d: Device): boolean {
  return deviceState(d).tone === "ok";
}

/** "3 d 4 h", "5 h 12 min", "40 s": the two largest units of a duration in seconds. */
export function duration(seconds: number): string {
  const unit = (n: number, u: "day" | "hour" | "minute" | "second") =>
    new Intl.NumberFormat(i18n.locale, { style: "unit", unit: u, unitDisplay: "short" }).format(n);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return h ? `${unit(d, "day")} ${unit(h, "hour")}` : unit(d, "day");
  if (h) return m ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
  if (m) return unit(m, "minute");
  return unit(Math.max(0, Math.floor(seconds)), "second");
}

/** Wi-Fi signal: 1–4 bars and a word, from RSSI in dBm (usual thresholds for 2.4 GHz). */
export function signal(rssi: number): { bars: 1 | 2 | 3 | 4; label: string } {
  if (rssi >= -55) return { bars: 4, label: t("agent.details.signal.excellent") };
  if (rssi >= -67) return { bars: 3, label: t("agent.details.signal.good") };
  if (rssi >= -75) return { bars: 2, label: t("agent.details.signal.fair") };
  return { bars: 1, label: t("agent.details.signal.weak") };
}

export function bytes(n: number): string {
  const fmt = (v: number, u: "kilobyte" | "megabyte" | "gigabyte" | "byte") =>
    new Intl.NumberFormat(i18n.locale, { style: "unit", unit: u, unitDisplay: "short", maximumFractionDigits: 1 }).format(v);
  if (n >= 2 ** 30) return fmt(n / 2 ** 30, "gigabyte");
  if (n >= 2 ** 20) return fmt(n / 2 ** 20, "megabyte");
  if (n >= 1024) return fmt(n / 1024, "kilobyte");
  return fmt(n, "byte");
}

/** Why an agent's connection ended, from the WebSocket close code (docs/PROTOCOL.md §7). */
export function closeReason(code: number): string {
  const known = [1000, 1001, 1006, 4000, 4001, 4002, 4003, 4004, 4008, 4029];
  return known.includes(code) ? t(`agent.details.close.${code}` as Key) : t("agent.details.close.other", { code });
}
