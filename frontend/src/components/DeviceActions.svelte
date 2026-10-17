<script lang="ts">
  // The controls of a device, from the actions the server says it supports (device page).
  import type { Device, DeviceAction } from "@awake/shared";
  import { runAction } from "../lib/actions.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import Switch from "./Switch.svelte";

  let { device, large = false }: { device: Device; large?: boolean } = $props();

  let busy = $state<DeviceAction | null>(null);
  const ready = $derived(device.status.ready);
  const waking = $derived(device.status.reach.state === "waking");

  async function run(action: DeviceAction) {
    busy = action;
    await runAction(device, action);
    busy = null;
  }

  const size = $derived(large ? "h-12 px-6 text-base" : "");
</script>

<div class="flex flex-wrap items-center gap-2">
  {#if device.actions.includes("wake")}
    {#if device.status.reach.state === "online"}
      <button class="btn-tonal {size}" disabled>{t("device.alreadyOn")}</button>
    {:else}
      <button class="btn-filled {size}" disabled={!ready || waking || busy !== null} onclick={(e) => (e.stopPropagation(), run("wake"))}>
        {busy === "wake" ? t("device.sending") : t("device.wake")}
      </button>
    {/if}
  {/if}
  {#if device.actions.includes("press")}
    <button class="btn-filled {size}" disabled={!ready || busy !== null} onclick={(e) => (e.stopPropagation(), run("press"))}>
      {busy === "press" ? t("device.sending") : t("device.press")}
    </button>
  {/if}
  {#if device.actions.includes("long_press")}
    <button class="btn-tonal {size}" disabled={!ready || busy !== null} onclick={(e) => (e.stopPropagation(), run("long_press"))}>{t("device.longPress")}</button>
  {/if}
  {#if device.actions.includes("on")}
    <Switch
      checked={device.status.output?.on === true}
      disabled={!ready || busy !== null}
      label={t("device.toggle", { name: device.name })}
      onchange={(on) => run(on ? "on" : "off")}
    />
  {/if}
</div>
