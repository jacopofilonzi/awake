<script lang="ts">
  import type { ErrorCode } from "@awake/shared";
  import AuthLayout from "../components/AuthLayout.svelte";
  import TextField from "../components/TextField.svelte";
  import { api, ApiFailure } from "../lib/api.ts";
  import { t, type Key } from "../lib/i18n/index.svelte.ts";
  import { clearQuery, link, navigate, router } from "../lib/router.svelte.ts";
  import { session, setMe } from "../lib/session.svelte.ts";
  import { errorText } from "../lib/ui.svelte.ts";

  let username = $state("");
  let password = $state("");
  let busy = $state(false);
  // A login provider redirects back here with ?error=<code>.
  let error = $state(router.route.query.get("error") ? t(`errors.${router.route.query.get("error") as ErrorCode}` as Key) : "");
  if (router.route.query.has("error")) clearQuery();

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      setMe(await api.auth.login(username, password));
      navigate("/", { replace: true });
    } catch (err) {
      error = err instanceof ApiFailure && err.code === "VALIDATION" ? t("errors.INVALID_CREDENTIALS") : errorText(err);
    } finally {
      busy = false;
    }
  }

  const providers = $derived(session.config?.providers ?? []);
</script>

<AuthLayout title={t("auth.login.title")} subtitle={t("auth.login.subtitle")}>
  <form class="space-y-4" onsubmit={submit}>
    <TextField label={t("auth.username")} bind:value={username} autocomplete="username" autocapitalize="none" required />
    <TextField label={t("auth.password")} type="password" bind:value={password} autocomplete="current-password" required />
    {#if error}<p class="rounded-lg bg-error-container px-3 py-2 text-sm text-error" role="alert">{error}</p>{/if}
    <button class="btn-filled w-full" disabled={busy}>{t("auth.login.submit")}</button>
  </form>

  {#if providers.length}
    <div class="my-5 flex items-center gap-3 text-xs text-muted"><span class="h-px flex-1 bg-outline-variant"></span>{t("auth.or")}<span class="h-px flex-1 bg-outline-variant"></span></div>
    <div class="grid gap-2">
      {#each providers as p (p.id)}
        <a class="btn-outlined w-full" href={api.auth.oauthUrl(p.id, "login", "/")}>{t("auth.continueWith", { provider: p.label })}</a>
      {/each}
    </div>
  {/if}

  {#if session.config?.registration.enabled}
    <p class="mt-6 text-center text-sm text-on-surface-variant">
      {t("auth.login.noAccount")} <a class="font-medium text-primary" href="/register" use:link>{t("auth.login.register")}</a>
    </p>
  {/if}
</AuthLayout>
