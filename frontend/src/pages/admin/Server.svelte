<script lang="ts">
  // Server settings stored in the database (registration) and the login providers. The public config
  // is refreshed after every change so the login page reflects it without a reload.
  import type { AdminProvider, ProviderInput, ServerSettings } from "@awake/shared";
  import AppShell from "../../components/AppShell.svelte";
  import Icon from "../../components/Icon.svelte";
  import Menu from "../../components/Menu.svelte";
  import MenuItem from "../../components/MenuItem.svelte";
  import Switch from "../../components/Switch.svelte";
  import TopBar from "../../components/TopBar.svelte";
  import ProviderDialog from "../../dialogs/ProviderDialog.svelte";
  import { api } from "../../lib/api.ts";
  import { t } from "../../lib/i18n/index.svelte.ts";
  import { session } from "../../lib/session.svelte.ts";
  import { confirmDialog, snack, snackError } from "../../lib/ui.svelte.ts";

  const cfg = $derived(session.config);
  let settings = $state<ServerSettings | null>(null);
  let providers = $state<AdminProvider[] | null>(null);
  let editing = $state<{ provider: AdminProvider | null } | null>(null);

  async function load() {
    try {
      [settings, providers] = await Promise.all([api.admin.settings(), api.admin.providers()]);
    } catch (err) {
      snackError(err);
    }
  }
  load();

  async function refreshConfig() {
    session.config = await api.config().catch(() => session.config);
  }

  async function saveSettings(patch: Partial<Pick<ServerSettings, "registrationEnabled" | "autoApprove">>) {
    if (!settings) return;
    try {
      settings = await api.admin.saveSettings({ registrationEnabled: settings.registrationEnabled, autoApprove: settings.autoApprove, ...patch });
      snack(t("admin.server.saved"));
      await refreshConfig();
    } catch (err) {
      snackError(err);
    }
  }

  function inputOf(p: AdminProvider): ProviderInput {
    // An empty secret keeps the stored one.
    return { label: p.label, type: p.type, issuer: p.issuer, clientId: p.clientId, clientSecret: "", scopes: p.scopes, enabled: p.enabled, allowSignup: p.allowSignup };
  }

  async function setEnabled(p: AdminProvider, enabled: boolean) {
    try {
      await api.admin.updateProvider(p.id, { ...inputOf(p), enabled });
      snack(t(enabled ? "admin.providers.enabledOn" : "admin.providers.enabledOff", { name: p.label }));
      await Promise.all([load(), refreshConfig()]);
    } catch (err) {
      snackError(err);
    }
  }

  async function remove(p: AdminProvider) {
    const text = p.linkedUsers ? t("admin.providers.deleteTextLinked", { name: p.label, n: p.linkedUsers }) : t("admin.providers.deleteText", { name: p.label });
    if (!(await confirmDialog({ title: t("admin.providers.deleteTitle"), text, confirm: t("common.delete"), danger: true }))) return;
    try {
      const res = await api.admin.removeProvider(p.id);
      snack(res.withoutLogin.length ? t("admin.providers.deletedNoLogin", { name: p.label, users: res.withoutLogin.join(", ") }) : t("admin.providers.deleted", { name: p.label }));
      await Promise.all([load(), refreshConfig()]);
    } catch (err) {
      snackError(err);
    }
  }

  function saved() {
    load();
    refreshConfig();
  }
</script>

<AppShell area="admin">
  <TopBar title={t("nav.server")} />
  <div class="max-w-3xl space-y-6 px-4 pt-4 md:px-3">
    <section class="card-outlined p-5">
      <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt class="text-on-surface-variant">{t("admin.server.version")}</dt><dd class="text-right font-mono">{cfg?.version ?? "—"}</dd>
        <dt class="text-on-surface-variant">{t("admin.server.protocol")}</dt><dd class="text-right font-mono">v{cfg?.protocolVersion ?? "—"}</dd>
        <dt class="text-on-surface-variant">{t("admin.server.address")}</dt><dd class="text-right font-mono">{location.origin}</dd>
      </dl>
    </section>

    <section class="space-y-2">
      <h3 class="text-base font-medium">{t("admin.server.registration")}</h3>
      <div class="card-outlined">
        {#if settings === null}
          <p class="p-4 text-sm text-muted">{t("common.loading")}</p>
        {:else}
          <div class="flex items-center gap-4 border-b border-on-surface/8 px-4 py-3">
            <div class="flex-1"><div class="text-sm font-medium">{t("admin.server.regEnabled")}</div><div class="text-xs text-on-surface-variant">{t("admin.server.regEnabledHint")}</div></div>
            <Switch checked={settings.registrationEnabled} label={t("admin.server.regEnabled")} onchange={(v) => saveSettings({ registrationEnabled: v })} />
          </div>
          <div class="flex items-center gap-4 px-4 py-3">
            <div class="flex-1"><div class="text-sm font-medium">{t("admin.server.autoApprove")}</div><div class="text-xs text-on-surface-variant">{t("admin.server.autoApproveHint")}</div></div>
            <Switch checked={settings.autoApprove} label={t("admin.server.autoApprove")} onchange={(v) => saveSettings({ autoApprove: v })} />
          </div>
        {/if}
      </div>
    </section>

    <section class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-base font-medium">{t("admin.server.providers")}</h3>
        <button class="btn-tonal h-9" disabled={settings?.secretKeyConfigured === false} onclick={() => (editing = { provider: null })}>
          <Icon name="add" size={20} />{t("admin.server.addProvider")}
        </button>
      </div>
      <p class="text-sm text-on-surface-variant">{t("admin.server.providersHint")}</p>
      {#if settings?.secretKeyConfigured === false}
        <p class="flex gap-2 rounded-xl bg-error-container px-4 py-3 text-sm text-error" role="alert"><Icon name="warning" size={20} />{t("admin.server.secretKeyMissing")}</p>
      {/if}
      <div class="card-outlined">
        {#if providers === null}
          <p class="p-4 text-sm text-muted">{t("common.loading")}</p>
        {:else if providers.length === 0}
          <p class="p-4 text-sm text-muted">{t("admin.server.noProviders")}</p>
        {:else}
          <ul>
            {#each providers as p (p.id)}
              <li class="flex items-center gap-3 px-4 py-3 not-last:border-b not-last:border-on-surface/8">
                <span class="grid size-10 shrink-0 place-items-center rounded-full bg-secondary-container text-on-secondary-container"><Icon name="key" size={20} /></span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium" class:text-muted={!p.enabled}>{p.label}</span>
                    {#if !p.enabled}<span class="chip h-6">{t("admin.server.off")}</span>{/if}
                  </div>
                  <div class="truncate text-xs text-on-surface-variant">
                    <span class="font-mono">{p.id}</span> · {p.type === "github" ? "GitHub" : "OIDC"}{p.issuer ? ` · ${p.issuer}` : ""} · {t("admin.server.linked", { n: p.linkedUsers })}
                  </div>
                </div>
                <Switch checked={p.enabled} label={t("admin.providers.enabled")} onchange={(v) => setEnabled(p, v)} />
                <Menu align="right">
                  {#snippet trigger(toggle)}<button class="icon-btn" onclick={toggle} aria-label={t("common.more")}><Icon name="more" /></button>{/snippet}
                  <MenuItem label={t("common.edit")} icon="edit" onclick={() => (editing = { provider: p })} />
                  <MenuItem label={t("common.delete")} icon="delete" danger onclick={() => remove(p)} />
                </Menu>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  </div>
</AppShell>

<ProviderDialog open={editing !== null} provider={editing?.provider ?? null} onclose={() => (editing = null)} onsaved={saved} />
