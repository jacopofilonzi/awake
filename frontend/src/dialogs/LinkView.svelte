<script lang="ts">
  import type { PasswordLink } from "@awake/shared";
  import Icon from "../components/Icon.svelte";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { i18n } from "../lib/i18n/index.svelte.ts";
  import { copy } from "../lib/ui.svelte.ts";

  let { link, username }: { link: PasswordLink; username: string } = $props();
  const expires = $derived(new Date(link.expiresAt).toLocaleString(i18n.locale, { dateStyle: "medium", timeStyle: "short" }));
</script>

<div class="space-y-3">
  <p class="text-sm text-on-surface-variant">{t("admin.users.linkText", { name: username, expires })}</p>
  <div class="flex items-center gap-2 rounded-xl bg-on-surface/6 px-3 py-2">
    <code class="flex-1 font-mono text-xs break-all">{link.url}</code>
    <button class="icon-btn" onclick={() => copy(link.url)} aria-label={t("common.copy")}><Icon name="copy" size={20} /></button>
  </div>
  <p class="flex gap-2 rounded-xl bg-warn-container px-3 py-2 text-sm text-warn"><Icon name="warning" size={20} />{t("admin.users.linkOnce")}</p>
</div>
