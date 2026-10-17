<script lang="ts">
  // A device tile: icon, name, status, and its main action as a round power button that glows while
  // the device is on (wake for Wake-on-LAN, press for buttons). Switches keep their toggle at the
  // bottom; a long press, when the output has one, is a small text button.
  import type { Device, DeviceAction } from "@awake/shared";
  import { runAction } from "../lib/actions.ts";
  import { deviceIcon, deviceKind, deviceState } from "../lib/format.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { navigate } from "../lib/router.svelte.ts";
  import Icon from "./Icon.svelte";
  import StatusPill from "./StatusPill.svelte";
  import Switch from "./Switch.svelte";

  let { device, subtitle = "" }: { device: Device; subtitle?: string } = $props();

  const st = $derived(deviceState(device));
  const lit = $derived(st.tone === "ok");
  const waking = $derived(device.status.reach.state === "waking");
  const ready = $derived(device.status.ready);
  const main = $derived<DeviceAction | null>(device.actions.includes("wake") ? "wake" : device.actions.includes("press") ? "press" : null);
  const mainLabel = $derived(main === "wake" ? (device.status.reach.state === "online" ? t("device.alreadyOn") : t("device.wake")) : t("device.press"));
  // A Wake-on-LAN device that is already online has nothing to do.
  const mainDisabled = $derived(!ready || waking || (main === "wake" && device.status.reach.state === "online"));

  let busy = $state(false);
  async function run(action: DeviceAction) {
    busy = true;
    await runAction(device, action);
    busy = false;
  }
  const open = () => navigate(`/devices/${device.id}`);
</script>

<div
  class="card relative flex min-h-44 cursor-pointer flex-col gap-4 p-4 transition-transform hover:-translate-y-0.5 max-sm:min-h-40 max-sm:p-3.5 {st.tone === 'error' ? 'opacity-60' : ''}"
  role="link"
  tabindex="0"
  onclick={open}
  onkeydown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
>
  <span class="grid size-11 place-items-center rounded-[14px] {lit ? 'bg-primary-container text-on-primary-container' : 'bg-glass-strong text-muted'}">
    <Icon name={deviceIcon(device)} />
  </span>

  {#if main}
    <button
      class="pwr absolute top-4 right-4 grid size-12 place-items-center rounded-full border transition-all max-sm:top-3.5 max-sm:right-3.5 max-sm:size-11
        {lit ? 'lit border-transparent bg-primary text-on-primary' : 'border-glass-line bg-glass-strong text-muted hover:text-on-surface'}
        {waking || busy ? 'waking text-warn' : ''}"
      disabled={mainDisabled || busy}
      title={mainLabel}
      aria-label="{mainLabel}: {device.name}"
      onclick={(e) => (e.stopPropagation(), run(main))}
    >
      <Icon name="power" size={20} />
    </button>
  {/if}

  <div class="min-w-0">
    <div class="truncate font-display text-lg leading-snug font-medium">{device.name}</div>
    <div class="truncate text-[0.8125rem] text-muted max-sm:hidden">{subtitle || deviceKind(device)}</div>
  </div>

  <div class="mt-auto flex flex-wrap items-center justify-between gap-2">
    <StatusPill {...st} />
    {#if device.actions.includes("long_press")}
      <button class="btn-text h-8 px-2 text-[0.8125rem]" disabled={!ready || busy} onclick={(e) => (e.stopPropagation(), run("long_press"))}>{t("device.longShort")}</button>
    {/if}
    {#if device.actions.includes("on")}
      <Switch checked={device.status.output?.on === true} disabled={!ready || busy} label={t("device.toggle", { name: device.name })} onchange={(on) => run(on ? "on" : "off")} />
    {/if}
  </div>
</div>

<style>
  .pwr.lit {
    box-shadow:
      0 0 0 6px color-mix(in srgb, var(--md-glow) 18%, transparent),
      0 6px 22px -4px var(--md-glow);
  }
  .pwr.waking {
    animation: pulse 1.6s infinite;
  }
  .pwr:disabled:not(.lit):not(.waking) {
    opacity: 0.5;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 8px color-mix(in srgb, var(--md-warn) 18%, transparent);
    }
  }
</style>
