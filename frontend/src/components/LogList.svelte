<script lang="ts">
  import type { LogEntry } from "@awake/shared";
  import { api } from "../lib/api.ts";
  import { data } from "../lib/data.svelte.ts";
  import { clock, logLine } from "../lib/format.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link } from "../lib/router.svelte.ts";
  import Icon from "./Icon.svelte";
  import StatusPill from "./StatusPill.svelte";

  let { houseId, deviceId, showHouse = false, limit = 100 }: { houseId?: string; deviceId?: string; showHouse?: boolean; limit?: number } = $props();

  let entries = $state<LogEntry[] | null>(null);
  let error = $state(false);

  async function load() {
    try {
      const all = await api.log({ houseId, limit: deviceId ? 200 : limit });
      entries = deviceId ? all.filter((e) => e.deviceId === deviceId).slice(0, limit) : all;
      error = false;
    } catch {
      error = true;
    }
  }

  // Reload when a device status changes (an action completed, a switch was flipped locally).
  const signature = $derived(data.devices.map((d) => `${d.id}:${d.status.reach.state}:${d.status.output?.on}`).join("|"));
  $effect(() => {
    void signature;
    void data.actions;
    void houseId;
    void deviceId;
    load();
  });
</script>

{#if error}
  <p class="px-4 py-6 text-sm text-error">{t("errors.NETWORK")}</p>
{:else if entries === null}
  <p class="px-4 py-6 text-sm text-muted">{t("common.loading")}</p>
{:else if entries.length === 0}
  <div class="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted"><Icon name="history" size={32} />{t("log.empty")}</div>
{:else}
  <ul>
    {#each entries as e (e.id)}
      {@const line = logLine(e)}
      <li class="flex items-center gap-3 px-4 py-3 not-last:border-b not-last:border-on-surface/8">
        <span class="w-24 shrink-0 font-mono text-xs text-muted">{clock(e.at)}</span>
        <div class="min-w-0 flex-1 text-sm">
          {#if e.deviceId && !deviceId}<a class="font-medium hover:underline" href="/devices/{e.deviceId}" use:link>{e.deviceName}</a>{:else if !deviceId}<span class="font-medium">{e.deviceName}</span>{/if}
          <span class="text-on-surface-variant">{deviceId ? "" : "· "}{line.action}</span>
          <span class="text-on-surface-variant">{t("log.by")}</span>
          <span class={e.source === "agent" ? "text-on-surface-variant italic" : ""}>{line.who}</span>
          {#if showHouse}<span class="block text-xs text-muted">{e.houseName}</span>{/if}
        </div>
        <StatusPill {...line.outcome} />
      </li>
    {/each}
  </ul>
{/if}
