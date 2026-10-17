<script lang="ts">
  // Dialog on the native <dialog> (focus trap, Esc, inert background): a centered glass card on wide
  // screens, a bottom sheet with a handle on phones (actions full width at the bottom).
  import type { Snippet } from "svelte";
  import type { IconName } from "../lib/icons.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import Icon from "./Icon.svelte";

  let {
    open,
    title,
    subtitle = "",
    icon,
    onclose,
    children,
    actions,
    wide = false,
  }: {
    open: boolean;
    title: string;
    subtitle?: string;
    icon?: IconName;
    onclose: () => void;
    children: Snippet;
    actions?: Snippet;
    wide?: boolean;
  } = $props();

  let el: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  });
</script>

<dialog
  bind:this={el}
  class="dlg {wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}"
  aria-labelledby="dlg-title"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
  onclick={(e) => {
    if (e.target === el) onclose();
  }}
>
  {#if open}
    <div class="flex max-h-[inherit] flex-col">
      <div class="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-on-surface/20 sm:hidden"></div>
      <header class="flex items-start gap-3 px-5 pt-4 pb-3 sm:px-6 sm:pt-6">
        {#if icon}<span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-on-primary-container"><Icon name={icon} /></span>{/if}
        <div class="min-w-0 flex-1">
          <h2 id="dlg-title" class="text-[1.4rem] leading-tight">{title}</h2>
          {#if subtitle}<p class="mt-1 text-sm text-muted">{subtitle}</p>{/if}
        </div>
        <button class="icon-btn -mt-1 -mr-2 max-sm:hidden" onclick={onclose} aria-label={t("common.close")}><Icon name="close" /></button>
      </header>
      <div class="flex-1 overflow-y-auto px-5 pb-2 outline-none sm:px-6">{@render children()}</div>
      {#if actions}
        <footer class="flex justify-end gap-2 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:flex-col-reverse max-sm:*:w-full sm:px-6 sm:pb-6">{@render actions()}</footer>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  .dlg {
    margin: auto;
    width: calc(100% - 2rem);
    max-height: calc(100dvh - 3rem);
    border-radius: 26px;
    border: 1px solid var(--md-glass-line);
    background: var(--md-surface-1);
    color: var(--md-on-surface);
    box-shadow: var(--md-shadow);
    overflow: hidden;
    padding: 0;
  }
  .dlg:focus-visible {
    outline: none;
  }
  .dlg::backdrop {
    background: var(--md-scrim);
    backdrop-filter: blur(4px);
  }
  .dlg[open] {
    animation: dlg-in 0.2s ease-out;
  }
  @keyframes dlg-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
  }
  @media (max-width: 639px) {
    .dlg {
      width: 100%;
      max-width: none;
      max-height: 92dvh;
      margin: auto 0 0;
      border-radius: 26px 26px 0 0;
      border-bottom: 0;
    }
    .dlg[open] {
      animation: sheet-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    }
  }
  @keyframes sheet-up {
    from {
      transform: translateY(100%);
    }
  }
</style>
