<script lang="ts">
  import type { Snippet } from "svelte";
  import type { IconName } from "../lib/icons.ts";
  import { link } from "../lib/router.svelte.ts";
  import Icon from "./Icon.svelte";

  let {
    label,
    icon,
    href,
    onclick,
    danger = false,
    selected = false,
    detail = "",
    trailing,
  }: {
    label: string;
    icon?: IconName;
    href?: string;
    onclick?: () => void;
    danger?: boolean;
    selected?: boolean;
    detail?: string;
    trailing?: Snippet;
  } = $props();

  const cls = $derived(
    `flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left text-sm font-semibold transition-colors max-sm:min-h-14 max-sm:text-[0.95rem] ${
      selected ? "bg-surface dark:bg-glass-strong shadow-soft" : "hover:bg-on-surface/6"
    } ${danger ? "text-error" : ""}`,
  );
</script>

{#snippet body()}
  {#if icon}
    <span class="grid size-8 shrink-0 place-items-center rounded-[10px] max-sm:size-10 {selected ? 'bg-primary-container text-on-primary-container' : 'bg-on-surface/6 text-on-surface-variant'} {danger ? 'text-error' : ''}">
      <Icon name={icon} size={18} />
    </span>
  {/if}
  <span class="min-w-0 flex-1">
    <span class="block truncate">{label}</span>
    {#if detail}<span class="block truncate text-xs font-medium text-muted">{detail}</span>{/if}
  </span>
  {#if trailing}{@render trailing()}{/if}
{/snippet}

{#if href}
  <a role="menuitem" class={cls} {href} use:link aria-current={selected ? "page" : undefined}>{@render body()}</a>
{:else}
  <button role="menuitem" class={cls} {onclick}>{@render body()}</button>
{/if}
