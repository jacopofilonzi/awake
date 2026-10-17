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
  import UsernameDialog from "../../dialogs/UsernameDialog.svelte";
  import { api } from "../../lib/api.ts";
  import { relativeTime, type Tone } from "../../lib/format.ts";
  import { t } from "../../lib/i18n/index.svelte.ts";
  import { session, setMe } from "../../lib/session.svelte.ts";
  import { confirmDialog, snack, snackError } from "../../lib/ui.svelte.ts";

  let users = $state<AdminUser[] | null>(null);
  let creating = $state(false);
  let linkFor = $state<{ username: string; link: PasswordLink } | null>(null);
  let renaming = $state<AdminUser | null>(null);

  async function load() {
    try {
      users = await api.admin.users();
    } catch (err) {
      snackError(err);
    }
  }
  load();

  const pending = $derived(users?.filter((u) => u.status === "pending").length ?? 0);
  const noLogin = $derived(users?.filter((u) => u.status === "active" && !u.canLogIn).length ?? 0);
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

  /** Errors are shown in the dialog (taken or invalid username). Renaming yourself updates the session. */
  async function rename(u: AdminUser, username: string) {
    if (username === u.username) return;
    await api.admin.updateUser(u.id, { username });
    if (u.id === session.user?.id) setMe(await api.auth.me());
    snack(t("admin.users.renamed", { old: u.username, name: username }));
    await load();
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
  <TopBar title={t("nav.users")}>
    {#snippet trailing()}<button class="btn-filled" onclick={() => (creating = true)} aria-label={t("admin.users.newTitle")}><Icon name="person-add" size={18} /><span class="max-sm:hidden">{t("admin.users.newTitle")}</span></button>{/snippet}
  </TopBar>
  <div class="max-w-5xl space-y-4 px-4 pt-4 md:px-3">
    <p class="flex items-center gap-3 rounded-xl bg-primary-container px-4 py-3 text-sm text-on-primary-container"><Icon name="info" size={20} />{t("admin.banner")}</p>

    <div class="flex items-baseline justify-end">
      <span class="flex gap-3 text-sm">
        {#if noLogin}<span class="text-error">{t("admin.users.noLoginCount", { n: noLogin })}</span>{/if}
        {#if pending}<span class="text-warn">{t("admin.users.pendingCount", { n: pending })}</span>{/if}
      </span>
    </div>

    <div class="card-outlined">
      {#if users === null}
        <p class="p-4 text-sm text-muted">{t("common.loading")}</p>
      {:else}
        <ul>
          {#each users as u (u.id)}
            {@const self = u.id === session.user?.id}
            <li class="flex flex-wrap items-center gap-3 px-4 py-3 not-last:border-b not-last:border-on-surface/8">
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
              {#if u.status === "active" && !u.canLogIn}
                <!-- No password and no enabled provider (e.g. its provider was deleted): needs a password link. -->
                <StatusPill tone="error" label={t("admin.users.noLogin")} />
                <button class="btn-tonal h-9" onclick={() => passwordLink(u)}><Icon name="link" size={18} />{t("admin.users.passwordLink")}</button>
              {:else}
                <StatusPill tone={tone[u.status]} label={t(`admin.users.status.${u.status}`)} />
              {/if}
              {#if u.status === "pending"}
                <button class="btn-filled h-9" onclick={() => update(u, { status: "active" }, t("admin.users.approved", { name: u.username }))}>{t("admin.users.approve")}</button>
              {/if}
              <Menu align="right">
                {#snippet trigger(toggle)}<button class="icon-btn" onclick={toggle} aria-label={t("common.more")}><Icon name="more" /></button>{/snippet}
                <MenuItem label={t("admin.users.rename")} icon="edit" onclick={() => (renaming = u)} />
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
  {#snippet actions()}<button class="btn-filled" onclick={() => (linkFor = null)}>{t("common.done")}</button>{/snippet}
</Dialog>

<UsernameDialog
  open={renaming !== null}
  icon="edit"
  title={t("admin.users.renameTitle")}
  subtitle={renaming?.username ?? ""}
  initial={renaming?.username ?? ""}
  hint={t("auth.usernameHint")}
  submitLabel={t("common.save")}
  onclose={() => (renaming = null)}
  onsubmit={(username) => rename(renaming!, username)}
/>
