<script lang="ts">
  // Diagnostics of an agent (owners/editors): connection history, what the agent reports about itself
  // (docs/PROTOCOL.md §5.2, last known while offline) and command statistics.
  import type { Agent, AgentDetails } from "@awake/shared";
  import { bytes, closeReason, duration, relativeTime, signal } from "../lib/format.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import SignalBars from "./SignalBars.svelte";

  let { agent, details }: { agent: Agent; details: AgentDetails } = $props();

  // Re-render every 30 s so "connected for" and uptimes move while the page stays open.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  const info = $derived(details.info);
  const conn = $derived(details.connection);
  // Uptime as of now: the agent reported it at infoAt; only meaningful while it is still connected.
  const uptime = $derived(
    info?.uptime !== undefined && details.infoAt !== null ? info.uptime + (agent.online ? Math.max(0, (now - details.infoAt) / 1000) : 0) : null,
  );
</script>

{#snippet row(label: string, value: string, mono = false)}
  <dt class="text-muted">{label}</dt>
  <dd class="min-w-0 text-right break-words {mono ? 'font-mono text-[0.8125rem]' : ''}">{value}</dd>
{/snippet}

{#snippet group(title: string)}
  <dt class="col-span-2 pt-2 text-[0.7rem] font-bold tracking-wider text-muted uppercase first:pt-0">{title}</dt>
{/snippet}

<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
  {@render group(t("agent.details.connection"))}
  {#if agent.online && conn.since}
    {@render row(t("agent.status"), t("agent.details.connectedFor", { d: duration((now - conn.since) / 1000) }))}
  {:else if conn.lastClose}
    {@render row(t("agent.status"), `${t("agent.details.disconnectedAgo", { when: relativeTime(conn.lastClose.at) })}: ${closeReason(conn.lastClose.code)}`)}
  {/if}
  {@render row(t("agent.details.connections24h"), String(conn.connections24h))}
  {#if conn.ip}{@render row(t("agent.details.publicIp"), conn.ip, true)}{/if}

  {#if info}
    {#if info.platform || info.host || uptime !== null || info.reset || info.mem !== undefined}
      {@render group(t("agent.details.system"))}
      {#if info.platform}{@render row(t("agent.details.platform"), info.platform)}{/if}
      {#if info.host}{@render row(t("agent.details.host"), info.host, true)}{/if}
      {#if uptime !== null}{@render row(t("agent.details.uptime"), duration(uptime))}{/if}
      {#if info.reset}{@render row(t("agent.details.reset"), t(`agent.details.resetReason.${info.reset}`))}{/if}
      {#if info.mem !== undefined}{@render row(t("agent.details.memory"), bytes(info.mem))}{/if}
    {/if}
    {#if info.ip || info.ssid || info.rssi !== undefined}
      {@render group(t("agent.details.network"))}
      {#if info.ip}{@render row(t("agent.details.lanIp"), info.ip, true)}{/if}
      {#if info.ssid}{@render row(t("agent.details.wifi"), info.ssid)}{/if}
      {#if info.rssi !== undefined}
        <dt class="text-muted">{t("agent.details.signalLabel")}</dt>
        <dd class="flex items-center justify-end gap-2"><SignalBars rssi={info.rssi} />{signal(info.rssi).label} · <span class="font-mono text-[0.8125rem]">{info.rssi} dBm</span></dd>
      {/if}
    {/if}
  {/if}

  {@render group(t("agent.details.commands"))}
  {@render row(
    t("agent.details.last24h"),
    details.stats.failed24h ? `${details.stats.commands24h} · ${t("agent.details.failedCount", { n: details.stats.failed24h })}` : String(details.stats.commands24h),
  )}
  {@render row(t("agent.details.lastCommand"), details.stats.lastCommandAt ? relativeTime(details.stats.lastCommandAt) : t("agent.details.none"))}
</dl>

{#if !info}
  <p class="mt-3 text-xs text-muted">{t("agent.details.noInfo")}</p>
{:else if details.infoAt && !agent.online}
  <p class="mt-3 text-xs text-muted">{t("agent.details.infoAge", { when: relativeTime(details.infoAt) })}</p>
{/if}
