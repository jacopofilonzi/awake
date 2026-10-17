<script lang="ts">
  // Admin: create a user with a password (to change at first login) or with a set-password link.
  import { passwordSchema, usernameSchema, type PasswordLink } from "@awake/shared";
  import Dialog from "../components/Dialog.svelte";
  import Segmented from "../components/Segmented.svelte";
  import TextField from "../components/TextField.svelte";
  import { api } from "../lib/api.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { errorText } from "../lib/ui.svelte.ts";
  import LinkView from "./LinkView.svelte";

  let { open, onclose, oncreated }: { open: boolean; onclose: () => void; oncreated: () => void } = $props();

  let username = $state("");
  let admin = $state(false);
  let mode = $state<"link" | "password">("link");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);
  let created = $state<{ username: string; link?: PasswordLink } | null>(null);

  $effect(() => {
    if (open) {
      username = password = error = "";
      admin = false;
      mode = "link";
      created = null;
    }
  });

  async function submit() {
    error = "";
    if (!usernameSchema.safeParse(username).success) return (error = t("errors.INVALID_USERNAME"));
    if (mode === "password" && !passwordSchema.safeParse(password).success) return (error = t("errors.INVALID_PASSWORD"));
    busy = true;
    try {
      const res = await api.admin.createUser({
        username: username.trim().toLowerCase(),
        admin,
        credentials: mode === "link" ? { type: "link" } : { type: "password", password },
      });
      created = { username: res.user.username, link: res.link };
      oncreated();
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} icon="person-add" title={created ? t("admin.users.createdTitle") : t("admin.users.newTitle")} subtitle={created?.username ?? ""}>
  {#if created}
    {#if created.link}
      <LinkView link={created.link} username={created.username} />
    {:else}
      <p class="text-sm text-on-surface-variant">{t("admin.users.createdWithPassword", { name: created.username })}</p>
    {/if}
  {:else}
    <form class="space-y-5" onsubmit={(e) => (e.preventDefault(), submit())}>
      <TextField label={t("auth.username")} bind:value={username} hint={t("auth.usernameHint")} autocapitalize="none" autocomplete="off" />
      <div>
        <span class="field-label">{t("admin.users.credentials")}</span>
        <Segmented label={t("admin.users.credentials")} bind:value={mode} options={[{ value: "link", label: t("admin.users.byLink") }, { value: "password", label: t("admin.users.byPassword") }]} />
        <p class="hint">{mode === "link" ? t("admin.users.byLinkHint") : t("admin.users.byPasswordHint")}</p>
      </div>
      {#if mode === "password"}
        <TextField label={t("auth.password")} type="text" bind:value={password} mono autocomplete="off" hint={t("auth.passwordHint")} />
      {/if}
      <label class="flex items-center gap-3 text-sm"><input type="checkbox" class="size-[18px] accent-(--md-primary)" bind:checked={admin} />{t("admin.users.makeAdmin")}</label>
      {#if error}<p class="rounded-xl bg-error-container px-3 py-2 text-sm text-error" role="alert">{error}</p>{/if}
    </form>
  {/if}
  {#snippet actions()}
    {#if created}
      <button class="btn-filled" onclick={onclose}>{t("common.done")}</button>
    {:else}
      <button class="btn-text" onclick={onclose}>{t("common.cancel")}</button>
      <button class="btn-filled" disabled={busy} onclick={submit}>{t("common.create")}</button>
    {/if}
  {/snippet}
</Dialog>
