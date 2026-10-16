<script lang="ts">
  // Global snackbar and confirm dialog (driven by lib/ui.svelte.ts).
  import { t } from "../lib/i18n/index.svelte.ts";
  import { answerConfirm, ui } from "../lib/ui.svelte.ts";
  import Dialog from "./Dialog.svelte";
</script>

{#if ui.snack}
  {#key ui.snack.id}
    <div
      role="status"
      class="fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-sm bg-inverse px-4 py-3.5 text-sm text-on-inverse shadow-lg sm:bottom-6"
    >
      {ui.snack.text}
      <button class="ml-2 font-medium text-primary-container" onclick={() => (ui.snack = null)}>{t("common.ok")}</button>
    </div>
  {/key}
{/if}

<Dialog open={!!ui.confirm} title={ui.confirm?.title ?? ""} icon={ui.confirm?.danger ? "warning" : "info"} onclose={() => answerConfirm(false)}>
  <p class="text-sm text-on-surface-variant">{ui.confirm?.text}</p>
  {#snippet actions()}
    <button class="btn-text" onclick={() => answerConfirm(false)}>{t("common.cancel")}</button>
    <button class={ui.confirm?.danger ? "btn-danger" : "btn-filled"} onclick={() => answerConfirm(true)}>{ui.confirm?.confirm}</button>
  {/snippet}
</Dialog>
