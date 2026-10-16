<script lang="ts">
  // M3 basic dialog on the native <dialog> (focus trap, Esc, inert background); full-screen on
  // compact widths, with a top bar holding close + title + the primary action.
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
  class="dlg {wide ? 'sm:max-w-2xl' : 'sm:max-w-xl'}"
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
      <!-- compact: top app bar -->
      <div class="flex items-center gap-1 px-1 py-2 sm:hidden">
        <button class="icon-btn" onclick={onclose} aria-label={t("common.close")}><Icon name="close" /></button>
        <span class="flex-1 truncate text-[1.375rem]">{title}</span>
      </div>
      <!-- expanded: centered headline -->
      <header class="hidden px-6 pt-6 pb-4 text-center sm:block">
        {#if icon}<Icon name={icon} class="mx-auto mb-3 text-primary" />{/if}
        <h2 id="dlg-title" class="text-2xl">{title}</h2>
        {#if subtitle}<p class="mt-1.5 text-sm text-on-surface-variant">{subtitle}</p>{/if}
      </header>
      <div class="flex-1 overflow-y-auto px-4 pb-2 sm:px-6">{@render children()}</div>
      {#if actions}
        <footer class="flex justify-end gap-2 px-4 pt-4 pb-5 sm:px-6 sm:pb-6">{@render actions()}</footer>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  .dlg {
    margin: auto;
    width: 100%;
    max-height: calc(100dvh - 3rem);
    border-radius: 28px;
    background: var(--md-surface-3);
    color: var(--md-on-surface);
    box-shadow: 0 4px 8px 3px rgb(0 0 0 / 0.15), 0 1px 3px rgb(0 0 0 / 0.3);
    overflow: hidden;
    padding: 0;
  }
  .dlg::backdrop {
    background: var(--md-scrim);
  }
  .dlg[open] {
    animation: dlg-in 0.18s ease-out;
  }
  @keyframes dlg-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
  }
  @media (max-width: 639px) {
    .dlg {
      max-width: none;
      max-height: none;
      height: 100dvh;
      border-radius: 0;
      background: var(--md-surface);
    }
  }
</style>
