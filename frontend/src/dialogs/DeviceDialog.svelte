<script lang="ts">
  // Create or edit a device: Wake-on-LAN (MAC + agents) or bound to an agent's output.
  import { deviceInputSchema, type Agent, type Device, type DeviceInput } from "@awake/shared";
  import Dialog from "../components/Dialog.svelte";
  import Segmented from "../components/Segmented.svelte";
  import TextField from "../components/TextField.svelte";
  import { api, ApiFailure } from "../lib/api.ts";
  import { reloadDevices } from "../lib/data.svelte.ts";
  import { t, type Key } from "../lib/i18n/index.svelte.ts";
  import { errorText, snack } from "../lib/ui.svelte.ts";

  let { open, houseId, houseName, device = null, onclose }: { open: boolean; houseId: string; houseName: string; device?: Device | null; onclose: () => void } = $props();

  let name = $state("");
  let kind = $state<"wol" | "output">("wol");
  let mac = $state("");
  let agentIds = $state<string[]>([]);
  let output = $state(""); // "<agentId>/<outputId>"
  let ip = $state("");
  let port = $state("");
  let agents = $state<Agent[]>([]);
  let errors = $state<Record<string, string>>({});
  let formError = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    const cfg = device?.config;
    name = device?.name ?? "";
    kind = cfg?.action.type ?? "wol";
    mac = cfg?.action.type === "wol" ? cfg.action.mac : "";
    agentIds = cfg?.action.type === "wol" ? [...cfg.action.agentIds] : [];
    output = cfg?.action.type === "output" && cfg.action.agentId ? `${cfg.action.agentId}/${cfg.action.outputId}` : "";
    ip = cfg?.ip ?? "";
    port = cfg?.probePort ? String(cfg.probePort) : "";
    errors = {};
    formError = "";
    api.houses.agents(houseId).then((list) => {
      agents = list;
      if (!device && agentIds.length === 0 && list.length === 1) agentIds = [list[0]!.id];
    }, () => (agents = []));
  });

  const outputs = $derived(agents.flatMap((a) => a.outputs.map((o) => ({ agent: a, out: o, key: `${a.id}/${o.id}` }))));

  function input(): unknown {
    const [agentId, outputId] = output.split("/");
    return {
      name,
      ip: ip.trim() || null,
      probePort: port.trim() ? Number(port) : null,
      action: kind === "wol" ? { type: "wol", mac, agentIds } : { type: "output", agentId: agentId ?? "", outputId: outputId ?? "" },
    };
  }

  const fieldOf = (path: string) => (path.startsWith("action.mac") ? "mac" : path.startsWith("action.agentIds") ? "agents" : path.startsWith("action") ? "output" : path);

  async function save() {
    errors = {};
    formError = "";
    if (kind === "output" && !output) return (errors = { output: t("device.form.pickOutput") });
    const parsed = deviceInputSchema.safeParse(input());
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const code = issue.message.startsWith("INVALID_") ? t(`errors.${issue.message}` as Key) : t("errors.VALIDATION");
      errors = { [fieldOf(issue.path.join("."))]: code };
      return;
    }
    busy = true;
    try {
      const body = parsed.data as DeviceInput;
      if (device) await api.devices.update(device.id, body);
      else await api.houses.createDevice(houseId, body);
      await reloadDevices();
      snack(device ? t("device.saved") : t("device.created"));
      onclose();
    } catch (err) {
      if (err instanceof ApiFailure && err.field) errors = { [fieldOf(err.field)]: errorText(err) };
      else formError = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog
  {open}
  {onclose}
  icon="devices"
  title={device ? t("device.form.editTitle") : t("device.form.newTitle")}
  subtitle={device ? device.name : t("device.form.inHouse", { house: houseName })}
>
  <form class="space-y-5" onsubmit={(e) => (e.preventDefault(), save())}>
    <TextField label={t("device.form.name")} bind:value={name} placeholder={t("device.form.namePlaceholder")} error={errors.name} maxlength={64} />

    <div>
      <span class="field-label">{t("device.form.how")}</span>
      <Segmented
        label={t("device.form.how")}
        bind:value={kind}
        options={[
          { value: "wol", label: t("device.kind.wol") },
          { value: "output", label: t("device.form.output") },
        ]}
      />
    </div>

    {#if kind === "wol"}
      <TextField label={t("device.form.mac")} bind:value={mac} placeholder="AA:BB:CC:DD:EE:FF" mono error={errors.mac} autocapitalize="characters" />
      <fieldset>
        <legend class="field-label">{t("device.form.agents")}</legend>
        {#if agents.length === 0}
          <p class="hint">{t("device.form.noAgents")}</p>
        {:else}
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            {#each agents as a (a.id)}
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" class="size-[18px] accent-(--md-primary)" value={a.id} bind:group={agentIds} />
                {a.name}
                <span class="size-2 rounded-full {a.online ? 'bg-ok' : 'bg-outline'}"></span>
              </label>
            {/each}
          </div>
          <p class="hint {errors.agents ? 'text-error!' : ''}">{errors.agents || t("device.form.agentsHint")}</p>
        {/if}
      </fieldset>
    {:else}
      <div>
        <label class="field-label" for="dev-output">{t("device.form.output")}</label>
        <select id="dev-output" class="input {errors.output ? 'border-error' : ''}" bind:value={output}>
          <option value="" disabled>{t("device.form.pickOutput")}</option>
          {#each outputs as o (o.key)}
            {@const taken = o.out.deviceId !== null && o.out.deviceId !== device?.id}
            <option value={o.key} disabled={taken}>
              {o.agent.name} / {o.out.id} — {o.out.mode === "switch" ? t("device.kind.switch") : o.out.long ? t("device.form.buttonLong") : t("device.kind.button")}{taken ? ` (${t("device.form.taken")})` : ""}
            </option>
          {/each}
        </select>
        <p class="hint {errors.output ? 'text-error!' : ''}">{errors.output || (outputs.length ? t("device.form.outputHint") : t("device.form.noOutputs"))}</p>
      </div>
    {/if}

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr]">
      <TextField label={t("device.form.ip")} bind:value={ip} placeholder="192.168.1.20" mono hint={t("device.form.ipHint")} error={errors.ip} inputmode="decimal" />
      <TextField label={t("device.form.port")} bind:value={port} placeholder="3389" mono hint={t("device.form.portHint")} error={errors.probePort} inputmode="numeric" />
    </div>
    {#if formError}<p class="rounded-lg bg-error-container px-3 py-2 text-sm text-error" role="alert">{formError}</p>{/if}
    <button type="submit" hidden aria-label={t("common.save")}></button>
  </form>
  {#snippet actions()}
    <button class="btn-text" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn-text" disabled={busy} onclick={save}>{device ? t("common.save") : t("common.add")}</button>
  {/snippet}
</Dialog>
