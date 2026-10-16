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
