<script lang="ts">
  import AppShell from "../components/AppShell.svelte";
  import DeviceCard from "../components/DeviceCard.svelte";
  import Icon from "../components/Icon.svelte";
  import TopBar from "../components/TopBar.svelte";
  import { checkDevices, data } from "../lib/data.svelte.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { untrack } from "svelte";

  $effect(() => {
    if (data.loaded) untrack(() => checkDevices(data.shared.map((d) => d.id)).catch(() => {}));
  });
</script>

<AppShell area="app">
  <TopBar title={t("shared.title")} />
  <div class="mx-auto max-w-6xl p-4 md:p-6">
    <p class="mb-4 max-w-xl text-sm text-on-surface-variant">{t("shared.intro")}</p>
    {#if data.shared.length === 0}
      <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-outline-variant px-6 py-14 text-center">
        <Icon name="share" size={36} class="text-muted" />
        <p class="text-on-surface-variant">{t("shared.empty")}</p>
      </div>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
        {#each data.shared as d (d.id)}<DeviceCard device={d} subtitle={d.houseName} />{/each}
      </div>
    {/if}
  </div>
</AppShell>
