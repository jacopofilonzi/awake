<script lang="ts">
  import type { House, HouseMember, Role } from "@awake/shared";
  import Icon from "../components/Icon.svelte";
  import Menu from "../components/Menu.svelte";
  import MenuItem from "../components/MenuItem.svelte";
  import UsernameDialog from "../dialogs/UsernameDialog.svelte";
  import { api } from "../lib/api.ts";
  import { data, reloadHouses } from "../lib/data.svelte.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { navigate } from "../lib/router.svelte.ts";
  import { session } from "../lib/session.svelte.ts";
  import { confirmDialog, snack, snackError } from "../lib/ui.svelte.ts";

  let { house }: { house: House } = $props();

  const isOwner = $derived(house.role === "owner");
  let members = $state<HouseMember[] | null>(null);
  let adding = $state(false);

  async function load() {
    try {
      members = await api.houses.members(house.id);
    } catch (err) {
      snackError(err);
    }
  }

  $effect(() => {
    void data.version[house.id];
    void house.id;
    load();
  });

  async function setRole(m: HouseMember, role: Role) {
    try {
      members = await api.houses.setRole(house.id, m.userId, role);
      if (m.userId === session.user?.id) await reloadHouses();
    } catch (err) {
      snackError(err);
    }
  }

  async function remove(m: HouseMember) {
    const self = m.userId === session.user?.id;
    const ok = await confirmDialog(
      self
        ? { title: t("house.leaveTitle"), text: t("house.leaveText", { name: house.name }), confirm: t("house.leave"), danger: true }
        : { title: t("members.removeTitle"), text: t("members.removeText", { name: m.username }), confirm: t("members.remove"), danger: true },
    );
    if (!ok) return;
    try {
      await api.houses.removeMember(house.id, m.userId);
      if (self) {
        await reloadHouses();
        navigate("/", { replace: true });
      } else await load();
    } catch (err) {
      snackError(err);
    }
  }
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <p class="max-w-xl text-sm text-on-surface-variant">{t("members.intro")}</p>
  {#if isOwner}<button class="btn-filled" onclick={() => (adding = true)}><Icon name="person-add" size={20} />{t("members.add")}</button>{/if}
</div>

<div class="card-outlined max-w-3xl">
  {#if members === null}
    <p class="p-4 text-sm text-muted">{t("common.loading")}</p>
  {:else}
    <ul>
      {#each members as m (m.userId)}
        {@const self = m.userId === session.user?.id}
        <li class="flex items-center gap-3 px-4 py-3 not-last:border-b not-last:border-outline-variant">
          <span class="grid size-10 shrink-0 place-items-center rounded-full bg-secondary-container font-medium text-on-secondary-container uppercase">{m.username[0]}</span>
          <div class="min-w-0 flex-1">
            <div class="font-medium">{m.username}{#if self}<span class="ml-1 text-xs font-normal text-muted">({t("members.you")})</span>{/if}</div>
            <div class="text-xs text-on-surface-variant">{t(`roles.${m.role}Desc`)}</div>
          </div>
          {#if isOwner}
            <Menu align="right">
              {#snippet trigger(toggle)}
                <button class="chip h-8 gap-1 pr-1" onclick={toggle}>{t(`roles.${m.role}`)}<Icon name="arrow-drop-down" size={20} /></button>
              {/snippet}
              {#each ["owner", "editor", "member"] as const as r (r)}
                <MenuItem label={t(`roles.${r}`)} selected={m.role === r} onclick={() => setRole(m, r)} />
              {/each}
              <div class="my-2 border-t border-outline-variant"></div>
              <MenuItem label={self ? t("house.leave") : t("members.remove")} icon={self ? "logout" : "delete"} danger onclick={() => remove(m)} />
            </Menu>
          {:else}
            <span class="chip">{t(`roles.${m.role}`)}</span>
            {#if self}<button class="btn-text" onclick={() => remove(m)}>{t("house.leave")}</button>{/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<UsernameDialog
  open={adding}
  icon="person-add"
  title={t("members.add")}
  subtitle={t("members.addSubtitle", { house: house.name })}
  withRole
  submitLabel={t("common.add")}
  onclose={() => (adding = false)}
  onsubmit={async (username, role) => {
    members = await api.houses.addMember(house.id, username, role);
    snack(t("members.added", { name: username }));
  }}
/>
