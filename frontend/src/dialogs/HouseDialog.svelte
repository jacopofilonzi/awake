<script lang="ts">
  import { HOUSE_ICONS, type House, type HouseIcon } from "@awake/shared";
  import Dialog from "../components/Dialog.svelte";
  import Icon from "../components/Icon.svelte";
  import TextField from "../components/TextField.svelte";
  import { api } from "../lib/api.ts";
  import { reloadHouses } from "../lib/data.svelte.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { HOUSE_ICON } from "../lib/icons.ts";
  import { errorText, snack } from "../lib/ui.svelte.ts";

  /** `house` given: edit its name and icon; otherwise create a new one. */
  let { open, house = null, onclose, oncreated }: { open: boolean; house?: House | null; onclose: () => void; oncreated?: (h: House) => void } = $props();

  let name = $state("");
  let icon = $state<HouseIcon>("house");
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) {
      name = house?.name ?? "";
      icon = house?.icon ?? "house";
      error = "";
    }
  });

  async function save(e?: SubmitEvent) {
    e?.preventDefault();
    if (!name.trim()) return (error = t("errors.VALIDATION"));
    busy = true;
    try {
      const saved = house ? await api.houses.update(house.id, { name: name.trim(), icon }) : await api.houses.create(name.trim(), icon);
      await reloadHouses();
      snack(house ? t("house.saved") : t("house.created"));
      onclose();
      if (!house) oncreated?.(saved);
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} icon={HOUSE_ICON[icon]} title={house ? t("house.editTitle") : t("house.newTitle")} subtitle={house ? "" : t("house.newSubtitle")}>
  <form onsubmit={save} class="space-y-4">
    <TextField label={t("house.name")} bind:value={name} placeholder={t("house.namePlaceholder")} error={error} maxlength={64} />
    <fieldset>
      <legend class="field-label">{t("house.icon")}</legend>
      <div class="grid grid-cols-6 gap-2" role="radiogroup" aria-label={t("house.icon")}>
        {#each HOUSE_ICONS as i (i)}
          <button
            type="button"
            role="radio"
            aria-checked={icon === i}
            aria-label={t(`house.icons.${i}`)}
            title={t(`house.icons.${i}`)}
            class="grid aspect-square place-items-center rounded-xl border transition-colors
              {icon === i ? 'border-transparent bg-primary text-on-primary shadow-soft' : 'border-glass-line bg-glass-strong text-on-surface-variant hover:text-on-surface'}"
            onclick={() => (icon = i)}
          >
            <Icon name={HOUSE_ICON[i]} size={22} />
          </button>
        {/each}
      </div>
      <p class="hint">{t(`house.icons.${icon}`)}</p>
    </fieldset>
  </form>
  {#snippet actions()}
    <button class="btn-text" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn-filled" disabled={busy} onclick={() => save()}>{house ? t("common.save") : t("common.create")}</button>
  {/snippet}
</Dialog>
