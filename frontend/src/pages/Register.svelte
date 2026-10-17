<script lang="ts">
  import { passwordSchema, usernameSchema } from "@awake/shared";
  import AuthLayout from "../components/AuthLayout.svelte";
  import TextField from "../components/TextField.svelte";
  import { api } from "../lib/api.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link, navigate } from "../lib/router.svelte.ts";
  import { session, setMe } from "../lib/session.svelte.ts";
  import { errorText } from "../lib/ui.svelte.ts";

  let username = $state("");
  let password = $state("");
  let confirm = $state("");
  let busy = $state(false);
  let error = $state("");
  let pending = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    if (!usernameSchema.safeParse(username).success) return (error = t("errors.INVALID_USERNAME"));
    if (!passwordSchema.safeParse(password).success) return (error = t("errors.INVALID_PASSWORD"));
    if (password !== confirm) return (error = t("auth.passwordsDiffer"));
    busy = true;
    try {
      const res = await api.auth.register(username, password);
      if (res.status === "pending") pending = true;
      else if (res.me) {
        setMe(res.me);
        navigate("/", { replace: true });
      }
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<AuthLayout title={t("auth.register.title")} subtitle={pending ? "" : t("auth.register.subtitle")}>
  {#if pending}
    <p class="rounded-xl bg-warn-container px-4 py-3 text-sm text-warn">{t("auth.register.pending")}</p>
    <a class="btn-text mt-4 w-full" href="/login" use:link>{t("auth.backToLogin")}</a>
  {:else if !session.config?.registration.enabled}
    <p class="text-center text-sm text-on-surface-variant">{t("errors.REGISTRATION_DISABLED")}</p>
    <a class="btn-text mt-4 w-full" href="/login" use:link>{t("auth.backToLogin")}</a>
  {:else}
    <form class="space-y-4" onsubmit={submit}>
      <TextField label={t("auth.username")} bind:value={username} hint={t("auth.usernameHint")} autocomplete="username" autocapitalize="none" required />
      <TextField label={t("auth.password")} type="password" bind:value={password} hint={t("auth.passwordHint")} autocomplete="new-password" required />
      <TextField label={t("auth.confirmPassword")} type="password" bind:value={confirm} autocomplete="new-password" required />
      {#if error}<p class="rounded-xl bg-error-container px-3 py-2 text-sm text-error" role="alert">{error}</p>{/if}
      <button class="btn-filled w-full" disabled={busy}>{t("auth.register.submit")}</button>
    </form>
    {#if !session.config.registration.autoApprove}<p class="hint mt-3 text-center">{t("auth.register.needsApproval")}</p>{/if}
    <a class="btn-text mt-4 w-full" href="/login" use:link>{t("auth.backToLogin")}</a>
  {/if}
</AuthLayout>
