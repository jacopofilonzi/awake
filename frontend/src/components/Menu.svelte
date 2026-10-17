<script lang="ts">
  // A menu anchored to its trigger: a popover on wide screens, a bottom sheet (with scrim and handle)
  // on phones. Closes on outside click, Esc or item click.
  import type { Snippet } from "svelte";

  let {
    trigger,
    children,
    align = "left",
    title = "",
  }: { trigger: Snippet<[() => void, boolean]>; children: Snippet; align?: "left" | "right"; title?: string } = $props();

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
    <!-- The scrim is inside `root`, so the outside-click check above doesn't see it: it closes the sheet itself. -->
    <div class="sheet-scrim fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] sm:hidden" aria-hidden="true" onpointerdown={() => (open = false)}></div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      role="menu"
      tabindex="-1"
      aria-label={title || undefined}
      class="menu-pop z-50 border border-glass-line bg-surface-1/95 p-1.5 shadow-soft backdrop-blur-xl
        max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-t-[26px] max-sm:px-3 max-sm:pt-2.5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]
        sm:absolute sm:top-[calc(100%+6px)] sm:min-w-60 sm:rounded-2xl {align === 'right' ? 'sm:right-0' : 'sm:left-0'}"
      onclick={() => (open = false)}
    >
      <div class="mx-auto mb-3 h-1 w-10 rounded-full bg-on-surface/20 sm:hidden"></div>
      {#if title}<div class="px-3 pt-1 pb-2 text-xs font-bold tracking-wider text-muted uppercase">{title}</div>{/if}
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .menu-pop {
    animation: pop 0.14s ease-out;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  @media (max-width: 639px) {
    .menu-pop {
      animation: sheet-up 0.28s cubic-bezier(0.32, 0.72, 0, 1);
    }
    .sheet-scrim {
      animation: fade 0.2s ease-out;
    }
  }
  @keyframes sheet-up {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
