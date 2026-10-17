<script lang="ts">
  // On/off switch; glows softly when on, like a lit device.
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
    width: 3rem;
    height: 1.75rem;
    flex-shrink: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--md-on-surface) 12%, transparent);
    transition:
      background 0.2s,
      box-shadow 0.2s;
  }
  .sw::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc(1.75rem - 6px);
    height: calc(1.75rem - 6px);
    border-radius: 999px;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .sw[aria-checked="true"] {
    background: var(--md-primary);
    box-shadow: 0 0 16px -2px var(--md-glow);
  }
  .sw[aria-checked="true"]::after {
    transform: translateX(1.25rem);
  }
  .sw:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
