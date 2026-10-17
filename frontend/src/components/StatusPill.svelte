<script lang="ts">
  import type { Tone } from "../lib/format.ts";

  let { tone, label }: { tone: Tone; label: string } = $props();

  // The text stays neutral; only the dot carries the color (muted palette).
  const dots: Record<Tone, string> = {
    ok: "bg-ok shadow-[0_0_0_3px_color-mix(in_srgb,var(--md-ok)_25%,transparent)]",
    off: "bg-outline",
    warn: "bg-warn animate-pulse",
    error: "bg-error",
    unknown: "bg-outline-variant",
  };
</script>

<span class="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-glass-strong px-2.5 text-xs font-semibold whitespace-nowrap {tone === 'unknown' ? 'text-muted' : 'text-on-surface-variant'}">
  <span class="size-1.5 shrink-0 rounded-full {dots[tone]}"></span><span class="truncate">{label}</span>
</span>
