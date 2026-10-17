<script lang="ts" generics="T extends string">
  // Segmented control (single select): pills on a soft track.
  let { options, value = $bindable(), label }: { options: { value: T; label: string }[]; value: T; label: string } = $props();
</script>

<div class="flex h-11 gap-1 rounded-xl bg-on-surface/6 p-1" role="radiogroup" aria-label={label}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value}
      class="flex flex-1 items-center justify-center rounded-[10px] px-3 text-sm font-semibold transition-colors
        {value === opt.value ? 'bg-surface-1 text-on-surface shadow-soft dark:bg-glass-strong' : 'text-muted hover:text-on-surface'}"
      onclick={() => (value = opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>
