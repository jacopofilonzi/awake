<script lang="ts">
  // Wi-Fi signal as 4 bars (RSSI in dBm), with the dBm and quality in the tooltip.
  import { signal } from "../lib/format.ts";

  let { rssi }: { rssi: number } = $props();
  const s = $derived(signal(rssi));
</script>

<span class="inline-flex h-3.5 items-end gap-[2px]" title="{rssi} dBm · {s.label}" role="img" aria-label="{s.label}, {rssi} dBm">
  {#each [1, 2, 3, 4] as b (b)}
    <span class="w-[3px] rounded-full {b <= s.bars ? 'bg-on-surface-variant' : 'bg-on-surface/15'}" style:height="{b * 25}%"></span>
  {/each}
</span>
