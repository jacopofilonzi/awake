<script lang="ts">
  // A menu anchored to its trigger: a popover on wide screens, a bottom sheet (with scrim and handle)
  // on phones. Closes on outside click, Esc, item click, and (popover) on scroll or resize.
  //
  // The popup is moved to <body>: inside a glass card (backdrop-filter) a `position: fixed` element is
  // placed relative to the card, not the screen, and an overflow-hidden ancestor would clip it. The
  // popover is therefore positioned with fixed coordinates from the trigger's rectangle.
  import type { Snippet } from "svelte";

  let {
    trigger,
    children,
    align = "left",
    title = "",
  }: { trigger: Snippet<[() => void, boolean]>; children: Snippet; align?: "left" | "right"; title?: string } = $props();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let popup: HTMLElement | undefined = $state();
  let pos = $state<{ top: number; left?: number; right?: number }>({ top: 0 });
  const toggle = () => (open = !open);

  function place() {
    const r = root?.getBoundingClientRect();
    if (!r) return;
    pos = align === "right" ? { top: r.bottom + 6, right: innerWidth - r.right } : { top: r.bottom + 6, left: r.left };
  }

  /** Moves the node to <body> for as long as it exists, keeping the color scheme of the area (admin). */
  function portal(node: HTMLElement) {
    if (root?.closest(".scheme-admin")) node.classList.add("scheme-admin");
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    if (!open) return;
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root?.contains(t) && !popup?.contains(t)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    // A fixed popover would drift away from its trigger: close it instead (the phone sheet stays).
    const onMove = () => {
      if (matchMedia("(min-width: 640px)").matches) open = false;
    };
    addEventListener("pointerdown", onDown);
    addEventListener("keydown", onKey);
    addEventListener("scroll", onMove, true);
    addEventListener("resize", onMove);
    return () => {
      removeEventListener("pointerdown", onDown);
      removeEventListener("keydown", onKey);
      removeEventListener("scroll", onMove, true);
      removeEventListener("resize", onMove);
    };
  });
</script>

<div class="relative" bind:this={root}>
  {@render trigger(toggle, open)}
</div>

{#if open}
  <div use:portal>
    <div class="sheet-scrim fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] sm:hidden" aria-hidden="true" onpointerdown={() => (open = false)}></div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      bind:this={popup}
      role="menu"
      tabindex="-1"
      aria-label={title || undefined}
      class="menu-pop fixed z-50 border border-glass-line bg-surface-1/95 p-1.5 text-on-surface shadow-soft backdrop-blur-xl
        max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-t-[26px] max-sm:px-3 max-sm:pt-2.5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]
        sm:max-h-[70dvh] sm:min-w-60 sm:overflow-y-auto sm:rounded-2xl"
      style:--top="{pos.top}px"
      style:--left={pos.left !== undefined ? `${pos.left}px` : "auto"}
      style:--right={pos.right !== undefined ? `${pos.right}px` : "auto"}
      onclick={() => (open = false)}
    >
      <div class="mx-auto mb-3 h-1 w-10 rounded-full bg-on-surface/20 sm:hidden"></div>
      {#if title}<div class="px-3 pt-1 pb-2 text-xs font-bold tracking-wider text-muted uppercase">{title}</div>{/if}
      {@render children()}
    </div>
  </div>
{/if}

<style>
  @media (min-width: 640px) {
    .menu-pop {
      top: var(--top);
      left: var(--left);
      right: var(--right);
      animation: pop 0.14s ease-out;
    }
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
