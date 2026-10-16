<script lang="ts">
  import type { Device } from "@awake/shared";
  import { deviceIcon, deviceKind, deviceState } from "../lib/format.ts";
  import { navigate } from "../lib/router.svelte.ts";
  import DeviceActions from "./DeviceActions.svelte";
  import Icon from "./Icon.svelte";
  import StatusPill from "./StatusPill.svelte";

  let { device, subtitle = "" }: { device: Device; subtitle?: string } = $props();

  const st = $derived(deviceState(device));
  const box = $derived(st.tone === "ok" ? "bg-primary-container text-on-primary-container" : st.tone === "warn" ? "bg-warn-container text-warn" : "bg-surface-3 text-on-surface-variant");
  const open = () => navigate(`/devices/${device.id}`);
</script>

<div
  class="card flex cursor-pointer flex-col gap-4 p-4 transition-shadow hover:shadow-md"
  role="link"
  tabindex="0"
  onclick={open}
  onkeydown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
>
  <div class="flex items-center gap-3.5">
    <span class="grid size-12 shrink-0 place-items-center rounded-xl {box}"><Icon name={deviceIcon(device)} /></span>
    <div class="min-w-0 flex-1">
      <div class="truncate font-medium">{device.name}</div>
      <div class="truncate text-xs text-on-surface-variant">{subtitle || deviceKind(device)}</div>
    </div>
  </div>
  <div class="flex items-center justify-between gap-2">
    <StatusPill {...st} />
    <DeviceActions {device} />
  </div>
</div>
