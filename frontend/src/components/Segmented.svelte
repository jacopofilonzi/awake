<script lang="ts" generics="T extends string">
  // M3 segmented button (single select).
  let { options, value = $bindable(), label }: { options: { value: T; label: string }[]; value: T; label: string } = $props();
</script>

<div class="flex h-10 overflow-hidden rounded-full border border-outline" role="radiogroup" aria-label={label}>
  {#each options as opt, i (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value}
      class="flex flex-1 items-center justify-center gap-1.5 px-3 text-sm font-medium transition-colors
        {i > 0 ? 'border-l border-outline' : ''}
        {value === opt.value ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface hover:bg-on-surface/8'}"
      onclick={() => (value = opt.value)}
    >
      {#if value === opt.value}<span aria-hidden="true">✓</span>{/if}{opt.label}
    </button>
  {/each}
</div>
