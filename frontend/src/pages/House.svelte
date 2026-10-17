<script lang="ts">
  import { untrack } from "svelte";
  // A house: header with the house switcher; one of its sections (devices, agents, members, log),
  // chosen from the navigation (sidebar on wide screens, dock on phones).
  import AppShell from "../components/AppShell.svelte";
  import DeviceCard from "../components/DeviceCard.svelte";
  import Icon from "../components/Icon.svelte";
  import LogList from "../components/LogList.svelte";
  import Menu from "../components/Menu.svelte";
  import MenuItem from "../components/MenuItem.svelte";
  import DeviceDialog from "../dialogs/DeviceDialog.svelte";
  import HouseDialog from "../dialogs/HouseDialog.svelte";
  import { api } from "../lib/api.ts";
  import { checkDevices, data, reloadHouses, rememberHouse } from "../lib/data.svelte.ts";
  import { isLit } from "../lib/format.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link, navigate, router } from "../lib/router.svelte.ts";
  import { session } from "../lib/session.svelte.ts";
  import { confirmDialog, snack, snackError } from "../lib/ui.svelte.ts";
  import HouseAgents from "./HouseAgents.svelte";
  import HouseMembers from "./HouseMembers.svelte";

  const id = $derived(router.route.params.id!);
  const house = $derived(data.house(id));
  const devices = $derived(data.devicesOf(id));
  const canEdit = $derived(house?.role === "owner" || house?.role === "editor");
  const tab = $derived(router.route.name);

  let deviceDialog = $state(false);
  let houseDialog = $state<"new" | "rename" | null>(null);
  let checking = $state(false);

  $effect(() => {
    if (house) rememberHouse(house.id);
  });

  // Probe the devices when the house is opened (the server reuses recent results). Only the house id
  // and the tab are dependencies: the probe results update the devices it would otherwise track.
  const probeKey = $derived(tab === "house" && house ? id : null);
  $effect(() => {
    if (probeKey) untrack(refresh);
  });

  async function refresh() {
    checking = true;
    try {
      await checkDevices(data.devicesOf(id).map((d) => d.id));
    } catch (err) {
      snackError(err);
    } finally {
      checking = false;
    }
  }

  async function removeHouse() {
    if (!house) return;
    const ok = await confirmDialog({ title: t("house.deleteTitle"), text: t("house.deleteText", { name: house.name }), confirm: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      await api.houses.remove(house.id);
      await reloadHouses();
      snack(t("house.deleted"));
      navigate("/", { replace: true });
    } catch (err) {
      snackError(err);
    }
  }

  async function leaveHouse() {
    if (!house || !session.user) return;
    const ok = await confirmDialog({ title: t("house.leaveTitle"), text: t("house.leaveText", { name: house.name }), confirm: t("house.leave"), danger: true });
    if (!ok) return;
    try {
      await api.houses.removeMember(house.id, session.user.id);
      await reloadHouses();
      navigate("/", { replace: true });
    } catch (err) {
      snackError(err);
    }
  }

  const sectionLabel = $derived(
    tab === "house-agents" ? t("house.tabs.agents") : tab === "house-members" ? t("house.tabs.members") : tab === "house-log" ? t("house.tabs.log") : "",
  );
</script>

<AppShell area="app">
  {#if !data.loaded}
    <p class="p-6 text-sm text-muted">{t("common.loading")}</p>
  {:else if !house}
    <div class="p-6"><p class="text-on-surface-variant">{t("errors.NOT_FOUND")}</p><a class="btn-text mt-2" href="/" use:link>{t("common.back")}</a></div>
  {:else}
    <header class="px-4 pt-4 md:px-3 md:pt-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <Menu title={t("nav.houses")}>
            {#snippet trigger(toggle, open)}
              <button class="flex max-w-full items-center gap-2 text-left" onclick={toggle} aria-expanded={open} aria-haspopup="menu">
                <h1 class="truncate text-[2rem] leading-tight md:text-[2.6rem]">{house.name}</h1>
                <span class="grid size-8 shrink-0 place-items-center rounded-full bg-glass-strong text-muted"><Icon name="arrow-drop-down" size={18} /></span>
              </button>
            {/snippet}
            {#each data.houses as h (h.id)}
              {@const ds = data.devicesOf(h.id)}
              <MenuItem label={h.name} icon="home" href="/houses/{h.id}" selected={h.id === id} detail="{t('nav.devicesOn', { on: ds.filter(isLit).length, n: ds.length })} · {t(`roles.${h.role}`)}">
                {#snippet trailing()}{#if h.id === id}<Icon name="check" size={18} class="text-primary" />{/if}{/snippet}
              </MenuItem>
            {/each}
            <div class="mx-2 my-1.5 border-t border-on-surface/8"></div>
            <MenuItem label={t("house.newTitle")} icon="add" onclick={() => (houseDialog = "new")} />
          </Menu>
          <p class="mt-1 text-sm text-muted">{#if sectionLabel}<b class="font-semibold text-on-surface-variant">{sectionLabel}</b>{" · "}{/if}{t(`roles.youAre.${house.role}`)}</p>
        </div>
        <div class="flex items-center gap-2">
          {#if tab === "house"}
            <button class="btn-tonal max-md:hidden" onclick={refresh} disabled={checking}><Icon name="refresh" size={18} class={checking ? "animate-spin" : ""} />{t("house.refresh")}</button>
            <button class="icon-btn md:hidden" onclick={refresh} disabled={checking} aria-label={t("house.refresh")}><Icon name="refresh" class={checking ? "animate-spin" : ""} /></button>
            {#if canEdit}<button class="btn-filled max-md:hidden" onclick={() => (deviceDialog = true)}><Icon name="add" size={18} />{t("device.form.newTitle")}</button>{/if}
          {/if}
          <Menu align="right">
            {#snippet trigger(toggle)}<button class="icon-btn" onclick={toggle} aria-label={t("common.more")}><Icon name="more" /></button>{/snippet}
            {#if house.role === "owner"}
              <MenuItem label={t("house.renameTitle")} icon="edit" onclick={() => (houseDialog = "rename")} />
              <MenuItem label={t("house.deleteTitle")} icon="delete" danger onclick={removeHouse} />
            {:else}
              <MenuItem label={t("house.leave")} icon="logout" danger onclick={leaveHouse} />
            {/if}
          </Menu>
        </div>
      </div>
    </header>

    <div class="px-4 pt-4 md:px-3">
      {#if tab === "house"}
        {#if devices.length === 0}
          <div class="card-outlined flex flex-col items-center gap-3 border-dashed px-6 py-14 text-center">
            <Icon name="devices" size={36} class="text-muted" />
            <p class="text-on-surface-variant">{t("house.noDevices")}</p>
            {#if canEdit}<button class="btn-tonal" onclick={() => (deviceDialog = true)}><Icon name="add" size={20} />{t("device.form.newTitle")}</button>{/if}
          </div>
        {:else}
          <div class="grid grid-cols-2 gap-3 max-md:pb-16 md:grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))]">
            {#each devices as d (d.id)}<DeviceCard device={d} />{/each}
          </div>
        {/if}
      {:else if tab === "house-agents"}
        <HouseAgents {house} />
      {:else if tab === "house-members"}
        <HouseMembers {house} />
      {:else if tab === "house-log"}
        <div class="card-outlined"><LogList houseId={id} /></div>
      {/if}
    </div>
  {/if}
</AppShell>

{#if house && canEdit && tab === "house"}
  <!-- phones: the page's main action floats above the dock, bottom right (wide screens have the header button) -->
  <button
    class="fixed right-4 bottom-[5.75rem] z-20 grid size-14 place-items-center rounded-2xl bg-primary text-on-primary shadow-[0_6px_22px_-4px_var(--md-glow)] md:hidden"
    onclick={() => (deviceDialog = true)}
    aria-label={t("device.form.newTitle")}
    title={t("device.form.newTitle")}
  >
    <Icon name="add" size={24} />
  </button>
{/if}

{#if house}
  <DeviceDialog open={deviceDialog} houseId={house.id} houseName={house.name} onclose={() => (deviceDialog = false)} />
{/if}
<HouseDialog open={houseDialog !== null} house={houseDialog === "rename" ? house : null} onclose={() => (houseDialog = null)} oncreated={(h) => navigate(`/houses/${h.id}`)} />
