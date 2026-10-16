<script lang="ts">
  import type { House } from "@awake/shared";
  import Dialog from "../components/Dialog.svelte";
  import TextField from "../components/TextField.svelte";
  import { api } from "../lib/api.ts";
  import { reloadHouses } from "../lib/data.svelte.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { errorText, snack } from "../lib/ui.svelte.ts";

  /** `house` given: rename it; otherwise create a new one. */
  let { open, house = null, onclose, oncreated }: { open: boolean; house?: House | null; onclose: () => void; oncreated?: (h: House) => void } = $props();

  let name = $state("");
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) {
      name = house?.name ?? "";
      error = "";
    }
  });

  async function save(e?: SubmitEvent) {
    e?.preventDefault();
    if (!name.trim()) return (error = t("errors.VALIDATION"));
    busy = true;
    try {
      const saved = house ? await api.houses.rename(house.id, name.trim()) : await api.houses.create(name.trim());
      await reloadHouses();
      snack(house ? t("house.renamed") : t("house.created"));
      onclose();
      if (!house) oncreated?.(saved);
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} icon="home" title={house ? t("house.renameTitle") : t("house.newTitle")} subtitle={house ? "" : t("house.newSubtitle")}>
  <form onsubmit={save}>
    <TextField label={t("house.name")} bind:value={name} placeholder={t("house.namePlaceholder")} error={error} maxlength={64} />
  </form>
  {#snippet actions()}
    <button class="btn-text" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn-text" disabled={busy} onclick={() => save()}>{house ? t("common.save") : t("common.create")}</button>
  {/snippet}
</Dialog>
