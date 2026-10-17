<script lang="ts">
  import type { Agent, House } from "@awake/shared";
  import Icon from "../components/Icon.svelte";
  import Menu from "../components/Menu.svelte";
  import MenuItem from "../components/MenuItem.svelte";
  import StatusPill from "../components/StatusPill.svelte";
  import AgentDialog from "../dialogs/AgentDialog.svelte";
  import { api } from "../lib/api.ts";
  import { data, reloadDevices } from "../lib/data.svelte.ts";
  import { relativeTime } from "../lib/format.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link } from "../lib/router.svelte.ts";
  import { confirmDialog, snack, snackError } from "../lib/ui.svelte.ts";

  let { house }: { house: House } = $props();

  const canEdit = $derived(house.role === "owner" || house.role === "editor");
  let agents = $state<Agent[] | null>(null);
  let dialog = $state<{ agent: Agent | null; token: string | null } | null>(null);

  async function load() {
    try {
      agents = await api.houses.agents(house.id);
    } catch (err) {
      snackError(err);
    }
  }

  // Refetch on live "agent" events for this house.
  $effect(() => {
    void data.version[house.id];
    void house.id;
    load();
  });

  async function regenerate(a: Agent) {
    const ok = await confirmDialog({ title: t("agent.regenerateTitle"), text: t("agent.regenerateText", { name: a.name }), confirm: t("agent.regenerate"), danger: true });
    if (!ok) return;
    try {
      const res = await api.agents.regenerateToken(a.id);
      dialog = { agent: null, token: res.token };
    } catch (err) {
      snackError(err);
    }
  }

  async function remove(a: Agent) {
    const ok = await confirmDialog({ title: t("agent.deleteTitle"), text: t("agent.deleteText", { name: a.name }), confirm: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      await api.agents.remove(a.id);
      snack(t("agent.deleted"));
      await Promise.all([load(), reloadDevices()]);
    } catch (err) {
      snackError(err);
    }
  }
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <p class="max-w-xl text-sm text-on-surface-variant">{t("agent.intro")}</p>
  {#if canEdit}<button class="btn-filled" onclick={() => (dialog = { agent: null, token: null })}><Icon name="add" size={20} />{t("agent.newTitle")}</button>{/if}
</div>

{#if agents === null}
  <p class="text-sm text-muted">{t("common.loading")}</p>
{:else if agents.length === 0}
  <div class="card-outlined flex flex-col items-center gap-3 border-dashed px-6 py-14 text-center">
    <Icon name="router" size={36} class="text-muted" />
    <p class="max-w-md text-on-surface-variant">{t("agent.empty")}</p>
  </div>
{:else}
  <div class="grid gap-3 lg:grid-cols-2">
    {#each agents as a (a.id)}
      <article class="card-outlined p-4">
        <div class="flex items-start gap-3">
          <span class="grid size-11 shrink-0 place-items-center rounded-xl {a.online ? 'bg-primary-container text-on-primary-container' : 'bg-glass-strong text-muted'}"><Icon name="router" /></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{a.name}</span>
              <StatusPill tone={a.online ? "ok" : "off"} label={a.online ? t("agent.online") : t("agent.offline")} />
            </div>
            <p class="mt-0.5 text-xs text-on-surface-variant">
              {a.firmware ?? t("agent.neverConnected")}{#if a.lastSeen && !a.online} · {t("agent.seen", { when: relativeTime(a.lastSeen) })}{/if}
            </p>
          </div>
          {#if canEdit}
            <Menu align="right">
              {#snippet trigger(toggle)}<button class="icon-btn" onclick={toggle} aria-label={t("common.more")}><Icon name="more" /></button>{/snippet}
              <MenuItem label={t("common.rename")} icon="edit" onclick={() => (dialog = { agent: a, token: null })} />
              <MenuItem label={t("agent.regenerate")} icon="key" onclick={() => regenerate(a)} />
              <MenuItem label={t("common.delete")} icon="delete" danger onclick={() => remove(a)} />
            </Menu>
          {/if}
        </div>
        <div class="mt-3 border-t border-on-surface/8 pt-2">
          <p class="py-1 text-xs font-medium text-on-surface-variant">{t("agent.outputs")}</p>
          {#if a.outputs.length === 0}
            <p class="py-1 text-sm text-muted">{t("agent.noOutputs")}</p>
          {:else}
            <ul>
              {#each a.outputs as o (o.id)}
                {@const dev = data.devices.find((d) => d.id === o.deviceId)}
                <li class="flex items-center gap-2 py-1.5 text-sm">
                  <span class="font-mono">{o.id}</span>
                  <span class="chip h-6">{o.mode === "switch" ? t("device.kind.switch") : o.long ? t("device.form.buttonLong") : t("device.kind.button")}</span>
                  {#if o.mode === "switch" && o.on !== null}<span class="text-xs text-on-surface-variant">{o.on ? t("status.on") : t("status.off")}</span>{/if}
                  <span class="flex-1"></span>
                  {#if dev}<a class="text-xs text-primary hover:underline" href="/devices/{dev.id}" use:link>{dev.name}</a>{:else}<span class="text-xs text-muted">{t("agent.free")}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </article>
    {/each}
  </div>
{/if}

<AgentDialog open={dialog !== null} houseId={house.id} agent={dialog?.agent ?? null} token={dialog?.token ?? null} onclose={() => (dialog = null)} onsaved={load} />
