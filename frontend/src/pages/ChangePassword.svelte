<script lang="ts">
  // Shown instead of the app while the account must change the password set by an admin.
  import { passwordSchema } from "@awake/shared";
  import AuthLayout from "../components/AuthLayout.svelte";
  import TextField from "../components/TextField.svelte";
  import { api } from "../lib/api.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { logout, setMe } from "../lib/session.svelte.ts";
  import { errorText } from "../lib/ui.svelte.ts";

  let current = $state("");
  let password = $state("");
  let confirm = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    if (!passwordSchema.safeParse(password).success) return (error = t("errors.INVALID_PASSWORD"));
    if (password !== confirm) return (error = t("auth.passwordsDiffer"));
    busy = true;
    try {
      setMe(await api.auth.changePassword(current, password));
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<AuthLayout title={t("auth.firstLogin.title")} subtitle={t("auth.firstLogin.subtitle")}>
  <form class="space-y-4" onsubmit={submit}>
    <TextField label={t("auth.currentPassword")} type="password" bind:value={current} autocomplete="current-password" required />
    <TextField label={t("auth.newPassword")} type="password" bind:value={password} hint={t("auth.passwordHint")} autocomplete="new-password" required />
    <TextField label={t("auth.confirmPassword")} type="password" bind:value={confirm} autocomplete="new-password" required />
    {#if error}<p class="rounded-xl bg-error-container px-3 py-2 text-sm text-error" role="alert">{error}</p>{/if}
    <button class="btn-filled w-full" disabled={busy}>{t("auth.firstLogin.submit")}</button>
  </form>
  <button class="btn-text mt-3 w-full" onclick={logout}>{t("account.logout")}</button>
</AuthLayout>
