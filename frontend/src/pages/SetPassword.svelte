<script lang="ts">
  // Opened from a link created by an admin: /set-password#<token> (the token never reaches the server
  // logs because it lives in the fragment).
  import { passwordSchema } from "@awake/shared";
  import AuthLayout from "../components/AuthLayout.svelte";
  import TextField from "../components/TextField.svelte";
  import { api } from "../lib/api.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link, navigate } from "../lib/router.svelte.ts";
  import { errorText, snack } from "../lib/ui.svelte.ts";

  const token = location.hash.slice(1);
  let username = $state<string | null>(null);
  let invalid = $state(!token);
  let password = $state("");
  let confirm = $state("");
  let busy = $state(false);
  let error = $state("");

  if (token) {
    api.auth.inspectLink(token).then(
      (info) => (username = info.username),
      () => (invalid = true),
    );
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    if (!passwordSchema.safeParse(password).success) return (error = t("errors.INVALID_PASSWORD"));
    if (password !== confirm) return (error = t("auth.passwordsDiffer"));
    busy = true;
    try {
      await api.auth.useLink(token, password);
      history.replaceState(null, "", "/set-password");
      snack(t("auth.setPassword.done"));
      navigate("/login", { replace: true });
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<AuthLayout title={t("auth.setPassword.title")} subtitle={username ? t("auth.setPassword.for", { username }) : ""}>
  {#if invalid}
    <p class="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{t("errors.INVALID_TOKEN")}</p>
    <a class="btn-text mt-4 w-full" href="/login" use:link>{t("auth.backToLogin")}</a>
  {:else if username}
    <form class="space-y-4" onsubmit={submit}>
      <TextField label={t("auth.newPassword")} type="password" bind:value={password} hint={t("auth.passwordHint")} autocomplete="new-password" required />
      <TextField label={t("auth.confirmPassword")} type="password" bind:value={confirm} autocomplete="new-password" required />
      {#if error}<p class="rounded-lg bg-error-container px-3 py-2 text-sm text-error" role="alert">{error}</p>{/if}
      <button class="btn-filled w-full" disabled={busy}>{t("auth.setPassword.submit")}</button>
    </form>
  {/if}
</AuthLayout>
