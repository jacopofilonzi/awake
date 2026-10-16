<script lang="ts">
  import type { Agent, DeviceShare } from "@awake/shared";
  import AppShell from "../components/AppShell.svelte";
  import DeviceActions from "../components/DeviceActions.svelte";
  import Icon from "../components/Icon.svelte";
  import LogList from "../components/LogList.svelte";
  import Menu from "../components/Menu.svelte";
  import MenuItem from "../components/MenuItem.svelte";
  import StatusPill from "../components/StatusPill.svelte";
  import TopBar from "../components/TopBar.svelte";
  import DeviceDialog from "../dialogs/DeviceDialog.svelte";
  import UsernameDialog from "../dialogs/UsernameDialog.svelte";
  import { api } from "../lib/api.ts";
  import { checkDevices, data, reloadDevices } from "../lib/data.svelte.ts";
  import { deviceIcon, deviceKind, deviceState, relativeTime } from "../lib/format.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link, navigate, router } from "../lib/router.svelte.ts";
  import { confirmDialog, snack, snackError } from "../lib/ui.svelte.ts";
  import { untrack } from "svelte";

  const id = $derived(router.route.params.id!);
  const device = $derived(data.devices.find((d) => d.id === id));
  const canEdit = $derived(device?.access === "owner" || device?.access === "editor");
  const st = $derived(device ? deviceState(device) : null);
  const back = $derived(device?.access === "shared" ? "/shared" : device ? `/houses/${device.houseId}` : "/");

  let editing = $state(false);
  let sharing = $state(false);
  let shares = $state<DeviceShare[]>([]);

  $effect(() => {
    const target = id;
    untrack(() => checkDevices([target]).catch(() => {}));
  });

  $effect(() => {
    if (!canEdit) return;
    const target = id;
    untrack(() => api.devices.shares(target).then((s) => (shares = s), () => (shares = [])));
  });

  // Agent names for the details (only owners and editors see the configuration).
  let agents = $state<Agent[]>([]);
  $effect(() => {
    if (!canEdit || !device) return;
    const house = device.houseId;
    untrack(() => api.houses.agents(house).then((a) => (agents = a), () => (agents = [])));
  });
  const agentName = (agentId: string) => agents.find((a) => a.id === agentId)?.name ?? "—";

  async function remove() {
    if (!device) return;
    const ok = await confirmDialog({ title: t("device.deleteTitle"), text: t("device.deleteText", { name: device.name }), confirm: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      const house = device.houseId;
      await api.devices.remove(device.id);
      await reloadDevices();
      snack(t("device.deleted"));
      navigate(`/houses/${house}`, { replace: true });
    } catch (err) {
      snackError(err);
    }
  }

  async function leave() {
    if (!device) return;
    const ok = await confirmDialog({ title: t("shared.removeTitle"), text: t("shared.removeText", { name: device.name }), confirm: t("shared.remove"), danger: true });
    if (!ok) return;
    try {
      await api.devices.leaveShared(device.id);
      await reloadDevices();
      navigate("/shared", { replace: true });
    } catch (err) {
      snackError(err);
    }
  }

  async function unshare(s: DeviceShare) {
    try {
      await api.devices.unshare(id, s.userId);
      shares = shares.filter((x) => x.userId !== s.userId);
      snack(t("device.shareRevoked", { name: s.username }));
    } catch (err) {
      snackError(err);
    }
  }
</script>

<AppShell area="app">
  {#if !device}
    <TopBar back="/" title={data.loaded ? t("errors.NOT_FOUND") : t("common.loading")} />
  {:else}
    <TopBar {back} title={device.name}>
      {#snippet trailing()}
        {#if canEdit}
          <button class="btn-text" onclick={() => (editing = true)}><Icon name="edit" size={20} />{t("common.edit")}</button>
          <Menu align="right">
            {#snippet trigger(toggle)}<button class="icon-btn" onclick={toggle} aria-label={t("common.more")}><Icon name="more" /></button>{/snippet}
            <MenuItem label={t("device.share")} icon="share" onclick={() => (sharing = true)} />
            <MenuItem label={t("common.delete")} icon="delete" danger onclick={remove} />
          </Menu>
        {:else if device.access === "shared"}
          <button class="btn-text" onclick={leave}>{t("shared.remove")}</button>
        {/if}
      {/snippet}
    </TopBar>

    <div class="mx-auto max-w-4xl space-y-3 p-4 md:p-6">
      <section class="card flex flex-wrap items-center gap-5 p-6">
        <span class="grid size-16 shrink-0 place-items-center rounded-2xl {st?.tone === 'ok' ? 'bg-primary-container text-on-primary-container' : st?.tone === 'warn' ? 'bg-warn-container text-warn' : 'bg-surface-3 text-on-surface-variant'}">
          <Icon name={deviceIcon(device)} size={32} />
        </span>
        <div class="min-w-0 flex-1">
          <h1 class="text-[1.75rem] leading-tight">{device.name}</h1>
          <div class="mt-1.5 flex flex-wrap items-center gap-2">
            {#if st}<StatusPill {...st} />{/if}
            {#if device.status.reach.checkedAt}<span class="text-xs text-muted">{t("device.checked", { when: relativeTime(device.status.reach.checkedAt) })}</span>{/if}
          </div>
        </div>
        <DeviceActions {device} large />
      </section>

      <div class="grid gap-3 md:grid-cols-2">
        <section class="card-outlined p-5">
          <h2 class="mb-3 text-base font-medium">{t("device.details")}</h2>
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-on-surface-variant">{t("device.house")}</dt>
            <dd class="text-right">{#if device.access === "shared"}{device.houseName}{:else}<a class="text-primary hover:underline" href="/houses/{device.houseId}" use:link>{device.houseName}</a>{/if}</dd>
            <dt class="text-on-surface-variant">{t("device.type")}</dt>
            <dd class="text-right">{deviceKind(device)}{device.status.output?.long ? ` · ${t("device.withLongPress")}` : ""}</dd>
            {#if device.config}
              {#if device.config.action.type === "wol"}
                <dt class="text-on-surface-variant">MAC</dt><dd class="text-right font-mono text-[0.8125rem]">{device.config.action.mac}</dd>
                <dt class="text-on-surface-variant">{t("device.form.agents")}</dt><dd class="text-right">{device.config.action.agentIds.map(agentName).join(", ") || "—"}</dd>
              {:else}
                <dt class="text-on-surface-variant">{t("device.form.output")}</dt>
                <dd class="text-right font-mono text-[0.8125rem]">{device.config.action.outputId || "—"} <span class="text-muted">@ {agentName(device.config.action.agentId)}</span></dd>
              {/if}
              <dt class="text-on-surface-variant">IP</dt>
              <dd class="text-right font-mono text-[0.8125rem]">{device.config.ip ?? "—"}{device.config.probePort ? `:${device.config.probePort}` : ""}</dd>
            {:else if device.access === "shared"}
              <dt class="text-on-surface-variant">{t("device.access")}</dt><dd class="text-right">{t("shared.useOnly")}</dd>
            {/if}
          </dl>
        </section>
        <section class="card-outlined">
          <h2 class="px-5 pt-5 pb-1 text-base font-medium">{t("device.history")}</h2>
          <LogList deviceId={device.id} houseId={device.access === "shared" ? undefined : device.houseId} limit={8} />
        </section>
      </div>

      {#if canEdit}
        <section class="card-outlined p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-medium">{t("device.sharing")}</h2>
              <p class="text-sm text-on-surface-variant">{t("device.sharingHint")}</p>
            </div>
            <button class="btn-outlined" onclick={() => (sharing = true)}><Icon name="share" size={20} />{t("device.share")}</button>
          </div>
          {#if shares.length}
            <ul class="mt-3">
              {#each shares as s (s.userId)}
                <li class="flex items-center gap-3 border-t border-outline-variant py-2.5 text-sm">
                  <span class="flex-1"><b class="font-medium">{s.username}</b> <span class="text-xs text-muted">{t("device.sharedSince", { when: relativeTime(s.createdAt) })}</span></span>
                  <button class="btn-text h-8" onclick={() => unshare(s)}>{t("device.revoke")}</button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </div>

    {#if canEdit}
      <DeviceDialog open={editing} houseId={device.houseId} houseName={device.houseName} {device} onclose={() => (editing = false)} />
      <UsernameDialog
        open={sharing}
        icon="share"
        title={t("device.share")}
        subtitle={t("device.shareSubtitle", { name: device.name })}
        submitLabel={t("device.share")}
        onclose={() => (sharing = false)}
        onsubmit={async (username) => {
          shares = await api.devices.share(id, username);
          snack(t("device.shared", { name: username }));
        }}
      />
    {/if}
  {/if}
</AppShell>
