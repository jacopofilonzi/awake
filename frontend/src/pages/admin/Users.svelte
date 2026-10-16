<script lang="ts">
  import type { AdminUser, PasswordLink } from "@awake/shared";
  import AppShell from "../../components/AppShell.svelte";
  import Dialog from "../../components/Dialog.svelte";
  import Icon from "../../components/Icon.svelte";
  import Menu from "../../components/Menu.svelte";
  import MenuItem from "../../components/MenuItem.svelte";
  import StatusPill from "../../components/StatusPill.svelte";
  import TopBar from "../../components/TopBar.svelte";
  import LinkView from "../../dialogs/LinkView.svelte";
  import NewUserDialog from "../../dialogs/NewUserDialog.svelte";
  import { api } from "../../lib/api.ts";
  import { relativeTime, type Tone } from "../../lib/format.ts";
  import { t } from "../../lib/i18n/index.svelte.ts";
  import { session } from "../../lib/session.svelte.ts";
  import { confirmDialog, snack, snackError } from "../../lib/ui.svelte.ts";

  let users = $state<AdminUser[] | null>(null);
  let creating = $state(false);
  let linkFor = $state<{ username: string; link: PasswordLink } | null>(null);

  async function load() {
    try {
      users = await api.admin.users();
    } catch (err) {
      snackError(err);
    }
  }
  load();

  const pending = $derived(users?.filter((u) => u.status === "pending").length ?? 0);
  const tone: Record<AdminUser["status"], Tone> = { active: "ok", pending: "warn", disabled: "off" };

  async function update(u: AdminUser, body: Parameters<typeof api.admin.updateUser>[1], message: string) {
    try {
      await api.admin.updateUser(u.id, body);
      snack(message);
      await load();
    } catch (err) {
      snackError(err);
    }
  }

  async function disable(u: AdminUser) {
    const ok = await confirmDialog({ title: t("admin.users.disableTitle"), text: t("admin.users.disableText", { name: u.username }), confirm: t("admin.users.disable"), danger: true });
    if (ok) await update(u, { status: "disabled" }, t("admin.users.disabled", { name: u.username }));
  }

  async function passwordLink(u: AdminUser) {
    try {
      linkFor = { username: u.username, link: await api.admin.passwordLink(u.id) };
    } catch (err) {
      snackError(err);
    }
  }

  async function remove(u: AdminUser) {
    const ok = await confirmDialog({ title: t("admin.users.deleteTitle"), text: t("admin.users.deleteText", { name: u.username }), confirm: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      await api.admin.removeUser(u.id);
      snack(t("admin.users.deleted", { name: u.username }));
      await load();
    } catch (err) {
      snackError(err);
    }
  }
</script>

<AppShell area="admin">
  <TopBar title={t("admin.title")}>
    {#snippet trailing()}<button class="btn-filled" onclick={() => (creating = true)}><Icon name="person-add" size={20} />{t("admin.users.newTitle")}</button>{/snippet}
  </TopBar>
  <div class="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
    <p class="flex items-center gap-3 rounded-xl bg-primary-container px-4 py-3 text-sm text-on-primary-container"><Icon name="info" size={20} />{t("admin.banner")}</p>

    <div class="flex items-baseline justify-between">
      <h2 class="text-[1.375rem]">{t("nav.users")}</h2>
      {#if pending}<span class="text-sm text-warn">{t("admin.users.pendingCount", { n: pending })}</span>{/if}
    </div>

    <div class="card-outlined">
      {#if users === null}
        <p class="p-4 text-sm text-muted">{t("common.loading")}</p>
      {:else}
        <ul>
          {#each users as u (u.id)}
            {@const self = u.id === session.user?.id}
            <li class="flex flex-wrap items-center gap-3 px-4 py-3 not-last:border-b not-last:border-outline-variant">
              <span class="grid size-10 shrink-0 place-items-center rounded-full bg-secondary-container font-medium text-on-secondary-container uppercase">{u.username[0]}</span>
              <div class="min-w-40 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{u.username}</span>
                  {#if self}<span class="text-xs text-muted">({t("members.you")})</span>{/if}
                  {#if u.admin}<span class="chip h-6">{t("admin.users.adminBadge")}</span>{/if}
                </div>
                <div class="text-xs text-on-surface-variant">
                  {[u.hasPassword ? t("admin.users.password") : null, ...u.providers].filter(Boolean).join(" · ") || t("admin.users.noCredentials")}
                  · {t("admin.users.lastLogin", { when: relativeTime(u.lastLoginAt) })}
                </div>
              </div>
              <StatusPill tone={tone[u.status]} label={t(`admin.users.status.${u.status}`)} />
              {#if u.status === "pending"}
                <button class="btn-filled h-9" onclick={() => update(u, { status: "active" }, t("admin.users.approved", { name: u.username }))}>{t("admin.users.approve")}</button>
              {/if}
              <Menu align="right">
                {#snippet trigger(toggle)}<button class="icon-btn" onclick={toggle} aria-label={t("common.more")}><Icon name="more" /></button>{/snippet}
                <MenuItem label={t("admin.users.passwordLink")} icon="link" onclick={() => passwordLink(u)} />
                {#if !self}
                  {#if u.admin}
                    <MenuItem label={t("admin.users.revokeAdmin")} icon="admin" onclick={() => update(u, { admin: false }, t("admin.users.updated"))} />
                  {:else}
                    <MenuItem label={t("admin.users.makeAdmin")} icon="admin" onclick={() => update(u, { admin: true }, t("admin.users.updated"))} />
                  {/if}
                  {#if u.status === "disabled"}
                    <MenuItem label={t("admin.users.enable")} icon="check" onclick={() => update(u, { status: "active" }, t("admin.users.updated"))} />
                  {:else if u.status === "active"}
                    <MenuItem label={t("admin.users.disable")} icon="close" onclick={() => disable(u)} />
                  {/if}
                  <MenuItem label={t("common.delete")} icon="delete" danger onclick={() => remove(u)} />
                {/if}
              </Menu>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</AppShell>

<NewUserDialog open={creating} onclose={() => (creating = false)} oncreated={load} />
<Dialog open={linkFor !== null} icon="link" title={t("admin.users.passwordLink")} subtitle={linkFor?.username ?? ""} onclose={() => (linkFor = null)}>
  {#if linkFor}<LinkView link={linkFor.link} username={linkFor.username} />{/if}
  {#snippet actions()}<button class="btn-text" onclick={() => (linkFor = null)}>{t("common.done")}</button>{/snippet}
</Dialog>
