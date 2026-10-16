<script lang="ts">
  // M3 switch: 52×32 track; the thumb grows when on.
  let {
    checked,
    disabled = false,
    label,
    onchange,
  }: { checked: boolean; disabled?: boolean; label: string; onchange: (on: boolean) => void } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  class="sw"
  onclick={(e) => {
    e.stopPropagation();
    onchange(!checked);
  }}
></button>

<style>
  .sw {
    position: relative;
    width: 52px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--md-surface-4);
    box-shadow: inset 0 0 0 2px var(--md-outline);
    transition: background 0.15s;
  }
  .sw::after {
    content: "";
    position: absolute;
    top: 8px;
    left: 8px;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--md-outline);
    transition: transform 0.15s, background 0.15s;
  }
  .sw[aria-checked="true"] {
    background: var(--md-primary);
    box-shadow: none;
  }
  .sw[aria-checked="true"]::after {
    transform: translateX(20px) scale(1.5);
    background: var(--md-on-primary);
  }
  .sw:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
</style>
