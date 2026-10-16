<script lang="ts">
  import type { Tone } from "../lib/format.ts";

  let { tone, label }: { tone: Tone; label: string } = $props();

  const styles: Record<Tone, string> = {
    ok: "bg-ok-container text-ok",
    off: "bg-surface-3 text-on-surface-variant",
    warn: "bg-warn-container text-warn",
    error: "bg-error-container text-error",
    unknown: "border border-outline-variant text-muted",
  };
</script>

<span class="inline-flex h-6 items-center gap-1.5 rounded-lg px-2 text-xs font-medium whitespace-nowrap {styles[tone]}">
  <span class="size-1.5 rounded-full bg-current {tone === 'warn' ? 'animate-pulse' : ''}"></span>{label}
</span>
