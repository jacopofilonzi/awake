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
  <div class="max-w-6xl px-4 pt-4 md:px-3">
    <p class="mb-4 max-w-xl text-sm text-on-surface-variant">{t("shared.intro")}</p>
    {#if data.shared.length === 0}
      <div class="card-outlined flex flex-col items-center gap-3 border-dashed px-6 py-14 text-center">
        <Icon name="share" size={36} class="text-muted" />
        <p class="text-on-surface-variant">{t("shared.empty")}</p>
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))]">
        {#each data.shared as d (d.id)}<DeviceCard device={d} subtitle={d.houseName} />{/each}
      </div>
    {/if}
  </div>
</AppShell>
