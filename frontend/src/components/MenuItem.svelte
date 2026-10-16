<script lang="ts">
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
  }: { label: string; icon?: IconName; href?: string; onclick?: () => void; danger?: boolean; selected?: boolean } = $props();

  const cls = $derived(
    `flex h-12 w-full items-center gap-3 px-4 text-left text-sm hover:bg-on-surface/8 ${danger ? "text-error" : ""} ${selected ? "bg-secondary-container text-on-secondary-container" : ""}`,
  );
</script>

{#if href}
  <a role="menuitem" class={cls} {href} use:link>{#if icon}<Icon name={icon} size={20} />{/if}{label}</a>
{:else}
  <button role="menuitem" class={cls} {onclick}>{#if icon}<Icon name={icon} size={20} />{/if}{label}</button>
{/if}
