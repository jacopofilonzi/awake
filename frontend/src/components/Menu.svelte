<script lang="ts">
  // M3 menu: a popover anchored to its trigger; closes on outside click, Esc or item click.
  import type { Snippet } from "svelte";

  let { trigger, children, align = "left" }: { trigger: Snippet<[() => void, boolean]>; children: Snippet; align?: "left" | "right" } = $props();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  const toggle = () => (open = !open);

  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    addEventListener("pointerdown", onDown);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("pointerdown", onDown);
      removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="relative" bind:this={root}>
  {@render trigger(toggle, open)}
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      role="menu"
      tabindex="-1"
      class="absolute top-[calc(100%+4px)] z-30 min-w-56 rounded-sm bg-surface-2 py-2 shadow-[0_2px_6px_2px_rgb(0_0_0/0.15),0_1px_2px_rgb(0_0_0/0.3)] {align === 'right' ? 'right-0' : 'left-0'}"
      onclick={() => (open = false)}
    >
      {@render children()}
    </div>
  {/if}
</div>
