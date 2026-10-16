<script lang="ts">
  // New agent (name → token shown once), rename, or show a regenerated token.
  import type { Agent } from "@awake/shared";
  import Dialog from "../components/Dialog.svelte";
  import Icon from "../components/Icon.svelte";
  import TextField from "../components/TextField.svelte";
  import { api } from "../lib/api.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { copy, errorText } from "../lib/ui.svelte.ts";

  let {
    open,
    houseId,
    agent = null,
    token = null,
    onclose,
    onsaved,
  }: { open: boolean; houseId: string; agent?: Agent | null; token?: string | null; onclose: () => void; onsaved: () => void } = $props();

  let name = $state("");
  let shownToken = $state<string | null>(null);
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) {
      name = agent?.name ?? "";
      shownToken = token;
      error = "";
    }
  });

  const serverUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/agent`;

  async function save() {
    if (!name.trim()) return (error = t("errors.VALIDATION"));
    busy = true;
    try {
      if (agent) {
        await api.agents.rename(agent.id, name.trim());
        onsaved();
        onclose();
      } else {
        shownToken = (await api.houses.createAgent(houseId, name.trim())).token;
        onsaved();
      }
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog
  {open}
  {onclose}
  icon={shownToken ? "key" : "router"}
  title={shownToken ? t("agent.tokenTitle") : agent ? t("agent.renameTitle") : t("agent.newTitle")}
  subtitle={shownToken ? t("agent.tokenSubtitle") : agent ? "" : t("agent.newSubtitle")}
  wide={!!shownToken}
>
  {#if shownToken}
    <div class="space-y-4">
      <div>
        <span class="field-label">{t("agent.token")}</span>
        <div class="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
          <code class="flex-1 font-mono text-sm break-all">{shownToken}</code>
          <button class="icon-btn" onclick={() => copy(shownToken!)} aria-label={t("common.copy")}><Icon name="copy" size={20} /></button>
        </div>
      </div>
      <div>
        <span class="field-label">{t("agent.configExample")}</span>
        <pre class="overflow-x-auto rounded-lg bg-inverse px-4 py-3 font-mono text-xs leading-relaxed text-on-inverse">server = "{serverUrl}"
token  = "{shownToken}"</pre>
        <p class="hint">{t("agent.configHint")}</p>
      </div>
      <p class="flex gap-2 rounded-lg bg-warn-container px-3 py-2 text-sm text-warn"><Icon name="warning" size={20} />{t("agent.tokenOnce")}</p>
    </div>
  {:else}
    <form onsubmit={(e) => (e.preventDefault(), save())}>
      <TextField label={t("agent.name")} bind:value={name} placeholder={t("agent.namePlaceholder")} {error} maxlength={64} />
    </form>
  {/if}
  {#snippet actions()}
    {#if shownToken}
      <button class="btn-text" onclick={onclose}>{t("common.done")}</button>
    {:else}
      <button class="btn-text" onclick={onclose}>{t("common.cancel")}</button>
      <button class="btn-text" disabled={busy} onclick={save}>{agent ? t("common.save") : t("common.create")}</button>
    {/if}
  {/snippet}
</Dialog>
