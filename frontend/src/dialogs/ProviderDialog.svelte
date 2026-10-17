<script lang="ts">
  // Add or edit a login provider. Presets only prefill the form: every provider is either a generic
  // OpenID Connect issuer or GitHub (github.com or a GitHub Enterprise URL).
  import { untrack } from "svelte";
  import { PROVIDER_ID_RE, type AdminProvider, type ProviderInput, type ProviderType } from "@awake/shared";
  import Dialog from "../components/Dialog.svelte";
  import Icon from "../components/Icon.svelte";
  import Segmented from "../components/Segmented.svelte";
  import Switch from "../components/Switch.svelte";
  import TextField from "../components/TextField.svelte";
  import { api, API_BASE, ApiFailure } from "../lib/api.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { copy, errorText, snack } from "../lib/ui.svelte.ts";

  let { open, provider = null, onclose, onsaved }: { open: boolean; provider?: AdminProvider | null; onclose: () => void; onsaved: () => void } = $props();

  type Preset = "google" | "microsoft" | "github" | "authentik" | "keycloak" | "oidc";
  const PRESETS: Record<Preset, { label: string; type: ProviderType; issuer: string; scopes: string; hint?: string }> = {
    google: { label: "Google", type: "oidc", issuer: "https://accounts.google.com", scopes: "openid email profile" },
    microsoft: { label: "Microsoft", type: "oidc", issuer: "https://login.microsoftonline.com/<tenant-id>/v2.0", scopes: "openid email profile", hint: "tenant" },
    github: { label: "GitHub", type: "github", issuer: "", scopes: "read:user user:email" },
    authentik: { label: "Authentik", type: "oidc", issuer: "https://auth.example.com/application/o/<slug>/", scopes: "openid email profile" },
    keycloak: { label: "Keycloak", type: "oidc", issuer: "https://keycloak.example.com/realms/<realm>", scopes: "openid email profile" },
    oidc: { label: "", type: "oidc", issuer: "", scopes: "openid email profile" },
  };

  let preset = $state<Preset>("google");
  let id = $state("");
  let idTouched = $state(false);
  let label = $state("");
  let type = $state<ProviderType>("oidc");
  let issuer = $state("");
  let clientId = $state("");
  let clientSecret = $state("");
  let scopes = $state("");
  let enabled = $state(true);
  let allowSignup = $state(false);
  let errors = $state<Record<string, string>>({});
  let formError = $state("");
  let busy = $state(false);
  let testing = $state(false);
  let lastPreset: Preset = "google";

  function applyPreset(p: Preset) {
    const v = PRESETS[p];
    label = v.label;
    type = v.type;
    issuer = v.issuer;
    scopes = v.scopes;
    if (!idTouched) id = slug(v.label || "oidc");
  }

  // Reset the form when the dialog opens; untracked so typing in it doesn't reset it again.
  $effect(() => {
    if (open) untrack(() => reset(provider));
  });

  function reset(provider: AdminProvider | null) {
    errors = {};
    formError = "";
    clientSecret = "";
    if (provider) {
      id = provider.id;
      label = provider.label;
      type = provider.type;
      issuer = provider.issuer ?? "";
      clientId = provider.clientId;
      scopes = provider.scopes;
      enabled = provider.enabled;
      allowSignup = provider.allowSignup;
    } else {
      preset = "google";
      idTouched = false;
      clientId = "";
      enabled = true;
      allowSignup = false;
      lastPreset = "google";
      applyPreset("google");
    }
  }

  // Picking a preset (creation only) refills the form.
  $effect(() => {
    if (provider || preset === lastPreset) return;
    lastPreset = preset;
    applyPreset(preset);
  });

  // The id follows the label until edited by hand.
  $effect(() => {
    if (!provider && !idTouched) id = slug(label || "oidc");
  });

  function slug(s: string): string {
    return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "oidc";
  }

  const redirectUri = $derived(provider?.redirectUri ?? `${location.origin}${API_BASE}/auth/oauth/${id || "…"}/callback`);

  function input(): ProviderInput {
    return {
      ...(provider ? {} : { id }),
      label: label.trim(),
      type,
      issuer: issuer.trim() || null,
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      scopes: scopes.trim(),
      enabled,
      allowSignup,
    };
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!provider && !PROVIDER_ID_RE.test(id)) e.id = t("admin.providers.idHint");
    if (!label.trim()) e.label = t("errors.VALIDATION");
    if (type === "oidc" && !issuer.trim()) e.issuer = t("admin.providers.issuerRequired");
    if (issuer.includes("<")) e.issuer = t("admin.providers.issuerPlaceholder");
    if (!clientId.trim()) e.clientId = t("errors.VALIDATION");
    if (!provider && !clientSecret.trim()) e.clientSecret = t("errors.VALIDATION");
    if (!scopes.trim()) e.scopes = t("errors.VALIDATION");
    errors = e;
    return Object.keys(e).length === 0;
  }

  async function test() {
    if (type === "oidc" && (!issuer.trim() || issuer.includes("<"))) return (errors = { issuer: t("admin.providers.issuerRequired") });
    testing = true;
    try {
      await api.admin.testProvider(type, issuer.trim() || null);
      snack(t("admin.providers.testOk"));
      errors = {};
    } catch (err) {
      errors = { issuer: errorText(err) };
    } finally {
      testing = false;
    }
  }

  async function save() {
    formError = "";
    if (!validate()) return;
    busy = true;
    try {
      if (provider) await api.admin.updateProvider(provider.id, input());
      else await api.admin.createProvider(input());
      snack(provider ? t("admin.providers.saved") : t("admin.providers.created"));
      onsaved();
      onclose();
    } catch (err) {
      if (err instanceof ApiFailure && err.field) errors = { [err.field]: errorText(err) };
      else formError = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} icon="key" wide title={provider ? t("admin.providers.editTitle") : t("admin.providers.newTitle")} subtitle={provider?.label ?? t("admin.providers.newSubtitle")}>
  <form class="space-y-5" onsubmit={(e) => (e.preventDefault(), save())}>
    {#if !provider}
      <div>
        <label class="field-label" for="pv-preset">{t("admin.providers.preset")}</label>
        <select id="pv-preset" class="input" bind:value={preset}>
          <option value="google">Google</option>
          <option value="microsoft">Microsoft (Entra ID)</option>
          <option value="github">GitHub</option>
          <option value="authentik">Authentik</option>
          <option value="keycloak">Keycloak</option>
          <option value="oidc">{t("admin.providers.otherOidc")}</option>
        </select>
      </div>
    {/if}

    <div class="grid gap-4 sm:grid-cols-2">
      <TextField label={t("admin.providers.label")} bind:value={label} hint={t("admin.providers.labelHint")} error={errors.label} maxlength={64} />
      {#if provider}
        <TextField label={t("admin.providers.id")} value={provider.id} disabled mono hint={t("admin.providers.idFixed")} />
      {:else}
        <TextField label={t("admin.providers.id")} bind:value={id} mono hint={t("admin.providers.idHint")} error={errors.id} oninput={() => (idTouched = true)} autocapitalize="none" />
      {/if}
    </div>

    <div>
      <span class="field-label">{t("admin.providers.type")}</span>
      <Segmented label={t("admin.providers.type")} bind:value={type} options={[{ value: "oidc", label: "OpenID Connect" }, { value: "github", label: "GitHub" }]} />
    </div>

    <div class="flex items-start gap-2">
      <div class="flex-1">
        <TextField
          label={type === "oidc" ? t("admin.providers.issuer") : t("admin.providers.githubBase")}
          bind:value={issuer}
          mono
          placeholder={type === "oidc" ? "https://…" : "https://github.example.com"}
          hint={type === "oidc" ? (preset === "microsoft" && !provider ? t("admin.providers.tenantHint") : t("admin.providers.issuerHint")) : t("admin.providers.githubBaseHint")}
          error={errors.issuer}
        />
      </div>
      {#if type === "oidc"}<button type="button" class="btn-outlined mt-[1.6rem] h-12" disabled={testing} onclick={test}>{t("admin.providers.test")}</button>{/if}
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <TextField label={t("admin.providers.clientId")} bind:value={clientId} mono error={errors.clientId} autocomplete="off" />
      <TextField
        label={t("admin.providers.clientSecret")}
        type="password"
        bind:value={clientSecret}
        mono
        autocomplete="new-password"
        placeholder={provider ? t("admin.providers.secretUnchanged") : ""}
        hint={t("admin.providers.secretHint")}
        error={errors.clientSecret}
      />
    </div>

    <TextField label={t("admin.providers.scopes")} bind:value={scopes} mono error={errors.scopes} />

    <div>
      <span class="field-label">{t("admin.providers.redirectUri")}</span>
      <div class="flex items-center gap-2 rounded-xl bg-on-surface/6 px-3 py-2">
        <code class="flex-1 font-mono text-xs break-all">{redirectUri}</code>
        <button type="button" class="icon-btn" onclick={() => copy(redirectUri)} aria-label={t("common.copy")}><Icon name="copy" size={20} /></button>
      </div>
      <p class="hint">{t("admin.providers.redirectHint")}</p>
    </div>

    <div class="space-y-3">
      <div class="flex items-center gap-4">
        <div class="flex-1"><div class="text-sm font-medium">{t("admin.providers.enabled")}</div><div class="text-xs text-on-surface-variant">{t("admin.providers.enabledHint")}</div></div>
        <Switch checked={enabled} label={t("admin.providers.enabled")} onchange={(v) => (enabled = v)} />
      </div>
      <div class="flex items-center gap-4">
        <div class="flex-1"><div class="text-sm font-medium">{t("admin.providers.allowSignup")}</div><div class="text-xs text-on-surface-variant">{t("admin.providers.allowSignupHint")}</div></div>
        <Switch checked={allowSignup} label={t("admin.providers.allowSignup")} onchange={(v) => (allowSignup = v)} />
      </div>
    </div>

    {#if formError}<p class="rounded-xl bg-error-container px-3 py-2 text-sm text-error" role="alert">{formError}</p>{/if}
    <button type="submit" hidden aria-label={t("common.save")}></button>
  </form>
  {#snippet actions()}
    <button class="btn-text" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn-filled" disabled={busy} onclick={save}>{provider ? t("common.save") : t("common.add")}</button>
  {/snippet}
</Dialog>
