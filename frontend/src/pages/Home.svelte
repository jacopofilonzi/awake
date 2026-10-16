<script lang="ts">
  // "/": opens the last visited house, or the first one; with no houses, a welcome to create one.
  import AppShell from "../components/AppShell.svelte";
  import Icon from "../components/Icon.svelte";
  import HouseDialog from "../dialogs/HouseDialog.svelte";
  import { data, lastHouse } from "../lib/data.svelte.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link, navigate } from "../lib/router.svelte.ts";
  import { session } from "../lib/session.svelte.ts";

  let creating = $state(false);

  $effect(() => {
    if (!data.loaded || data.houses.length === 0) return;
    const last = lastHouse();
    const target = data.houses.find((h) => h.id === last) ?? data.houses[0]!;
    navigate(`/houses/${target.id}`, { replace: true });
  });
</script>

<AppShell area="app">
  {#if data.loaded && data.houses.length === 0}
    <div class="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <span class="grid size-20 place-items-center rounded-3xl bg-primary-container text-on-primary-container"><Icon name="home" size={40} /></span>
      <h1 class="mt-6 text-[1.75rem]">{t("home.welcome", { name: session.user?.username ?? "" })}</h1>
      <p class="mt-2 text-on-surface-variant">{t("home.noHouses")}</p>
      <button class="btn-filled mt-8" onclick={() => (creating = true)}><Icon name="add" size={20} />{t("house.newTitle")}</button>
      {#if data.shared.length}
        <a class="btn-text mt-3" href="/shared" use:link>{t("home.seeShared", { n: data.shared.length })}</a>
      {/if}
    </div>
  {/if}
</AppShell>

<HouseDialog open={creating} onclose={() => (creating = false)} oncreated={(h) => navigate(`/houses/${h.id}`)} />
