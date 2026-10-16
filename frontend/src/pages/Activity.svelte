<script lang="ts">
  import AppShell from "../components/AppShell.svelte";
  import LogList from "../components/LogList.svelte";
  import TopBar from "../components/TopBar.svelte";
  import { t } from "../lib/i18n/index.svelte.ts";
</script>

<AppShell area="app">
  <TopBar title={t("activity.title")} />
  <div class="mx-auto max-w-4xl p-4 md:p-6">
    <p class="mb-4 text-sm text-on-surface-variant">{t("activity.intro")}</p>
    <div class="card-outlined"><LogList showHouse limit={150} /></div>
  </div>
</AppShell>
