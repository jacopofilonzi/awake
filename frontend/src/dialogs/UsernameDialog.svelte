<script lang="ts">
  // Asks for a username (and optionally a role): adding a house member or sharing a device.
  import type { Role } from "@awake/shared";
  import Dialog from "../components/Dialog.svelte";
  import TextField from "../components/TextField.svelte";
  import type { IconName } from "../lib/icons.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { errorText } from "../lib/ui.svelte.ts";

  let {
    open,
    title,
    subtitle = "",
    icon,
    withRole = false,
    submitLabel,
    onclose,
    onsubmit,
  }: {
    open: boolean;
    title: string;
    subtitle?: string;
    icon: IconName;
    withRole?: boolean;
    submitLabel: string;
    onclose: () => void;
    onsubmit: (username: string, role: Role) => Promise<void>;
  } = $props();

  let username = $state("");
  let role = $state<Role>("member");
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) {
      username = "";
      role = "member";
      error = "";
    }
  });

  async function submit() {
    if (!username.trim()) return (error = t("errors.INVALID_USERNAME"));
    busy = true;
    try {
      await onsubmit(username.trim().toLowerCase(), role);
      onclose();
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} {icon} {title} {subtitle}>
  <form class="space-y-5" onsubmit={(e) => (e.preventDefault(), submit())}>
    <TextField label={t("auth.username")} bind:value={username} autocapitalize="none" autocomplete="off" {error} />
    {#if withRole}
      <fieldset class="space-y-2">
        <legend class="field-label">{t("members.role")}</legend>
        {#each ["member", "editor", "owner"] as const as r (r)}
          <label class="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-on-surface/5">
            <input type="radio" class="mt-1 size-[18px] accent-(--md-primary)" value={r} bind:group={role} />
            <span><span class="block text-sm font-medium">{t(`roles.${r}`)}</span><span class="block text-xs text-on-surface-variant">{t(`roles.${r}Desc`)}</span></span>
          </label>
        {/each}
      </fieldset>
    {/if}
  </form>
  {#snippet actions()}
    <button class="btn-text" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn-text" disabled={busy} onclick={submit}>{submitLabel}</button>
  {/snippet}
</Dialog>
