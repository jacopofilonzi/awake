<script lang="ts">
  import { untrack } from "svelte";
  // A house: top bar with the house switcher, tabs (devices, agents, members, log).
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

  const tabs = $derived([
    { name: "house", href: `/houses/${id}`, label: t("house.tabs.devices"), icon: "devices" as const },
    { name: "house-agents", href: `/houses/${id}/agents`, label: t("house.tabs.agents"), icon: "router" as const },
    { name: "house-members", href: `/houses/${id}/members`, label: t("house.tabs.members"), icon: "group" as const },
    { name: "house-log", href: `/houses/${id}/log`, label: t("house.tabs.log"), icon: "history" as const },
  ]);
</script>

<AppShell area="app">
  {#if !data.loaded}
    <p class="p-6 text-sm text-muted">{t("common.loading")}</p>
  {:else if !house}
    <div class="p-6"><p class="text-on-surface-variant">{t("errors.NOT_FOUND")}</p><a class="btn-text mt-2" href="/" use:link>{t("common.back")}</a></div>
  {:else}
    <header class="sticky top-0 z-10 bg-surface">
      <div class="flex h-16 items-center gap-2 px-3 md:px-6">
        <Menu>
          {#snippet trigger(toggle, open)}
            <button class="flex h-10 items-center gap-1.5 rounded-lg border border-outline pr-2 pl-3 text-sm font-medium" onclick={toggle} aria-expanded={open}>
              <Icon name="home" size={20} /><span class="max-w-[40vw] truncate">{house.name}</span><Icon name="arrow-drop-down" size={20} />
            </button>
          {/snippet}
          {#each data.houses as h (h.id)}
            <MenuItem label={h.name} icon="home" href="/houses/{h.id}" selected={h.id === id} />
          {/each}
          <div class="my-2 border-t border-outline-variant"></div>
          <MenuItem label={t("house.newTitle")} icon="add" onclick={() => (houseDialog = "new")} />
        </Menu>
        <span class="flex-1"></span>
        {#if tab === "house"}
          <button class="icon-btn" onclick={refresh} disabled={checking} aria-label={t("house.refresh")} title={t("house.refresh")}><Icon name="refresh" class={checking ? "animate-spin" : ""} /></button>
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
      <nav class="flex overflow-x-auto border-b border-surface-4 px-3 md:px-6" aria-label={house.name}>
        {#each tabs as tb (tb.name)}
          <a
            href={tb.href}
            use:link
            class="relative flex shrink-0 items-center gap-2 px-4 py-3.5 text-sm font-medium {tab === tb.name ? 'text-primary' : 'text-on-surface-variant'}"
            aria-current={tab === tb.name ? "page" : undefined}
          >
            <Icon name={tb.icon} size={20} />{tb.label}
            {#if tab === tb.name}<span class="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary"></span>{/if}
          </a>
        {/each}
      </nav>
    </header>

    <div class="mx-auto max-w-6xl p-4 md:p-6">
      {#if tab === "house"}
        <p class="mb-4 text-sm text-on-surface-variant">{t(`roles.youAre.${house.role}`)}</p>
        {#if devices.length === 0}
          <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-outline-variant px-6 py-14 text-center">
            <Icon name="devices" size={36} class="text-muted" />
            <p class="text-on-surface-variant">{t("house.noDevices")}</p>
            {#if canEdit}<button class="btn-tonal" onclick={() => (deviceDialog = true)}><Icon name="add" size={20} />{t("device.form.newTitle")}</button>{/if}
          </div>
        {:else}
          <div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
            {#each devices as d (d.id)}<DeviceCard device={d} />{/each}
          </div>
        {/if}
        {#if canEdit && devices.length > 0}
          <button
            class="fixed right-4 bottom-24 z-10 flex h-14 items-center gap-3 rounded-2xl bg-primary-container pr-5 pl-4 text-sm font-medium text-on-primary-container shadow-[0_1px_3px_rgb(0_0_0/0.3),0_4px_8px_3px_rgb(0_0_0/0.15)] md:right-6 md:bottom-6"
            onclick={() => (deviceDialog = true)}
          >
            <Icon name="add" />{t("device.form.newTitle")}
          </button>
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

{#if house}
  <DeviceDialog open={deviceDialog} houseId={house.id} houseName={house.name} onclose={() => (deviceDialog = false)} />
{/if}
<HouseDialog open={houseDialog !== null} house={houseDialog === "rename" ? house : null} onclose={() => (houseDialog = null)} oncreated={(h) => navigate(`/houses/${h.id}`)} />
