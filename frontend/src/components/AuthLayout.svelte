<script lang="ts">
  import type { Snippet } from "svelte";
  import { i18n, setLocale, t } from "../lib/i18n/index.svelte.ts";
  import { cycleTheme } from "../lib/theme.svelte.ts";
  import Icon from "./Icon.svelte";

  let { title, subtitle = "", children }: { title: string; subtitle?: string; children: Snippet } = $props();
</script>

<div class="grid min-h-dvh place-items-center bg-surface-2 p-4">
  <div class="w-full max-w-md">
    <div class="rounded-[28px] bg-surface px-6 py-8 sm:px-8">
      <div class="mb-2 flex justify-center text-primary"><Icon name="power" size={40} /></div>
      <h1 class="text-center text-[1.75rem]">{title}</h1>
      {#if subtitle}<p class="mt-1 text-center text-sm text-on-surface-variant">{subtitle}</p>{/if}
      <div class="mt-6">{@render children()}</div>
    </div>
    <div class="mt-4 flex items-center justify-between px-2">
      <div class="flex gap-1 text-xs">
        {#each ["it", "en"] as const as l (l)}
          <button class="rounded-md px-2 py-1 uppercase {i18n.locale === l ? 'bg-on-surface text-surface' : 'text-on-surface-variant'}" onclick={() => setLocale(l)}>{l}</button>
        {/each}
      </div>
      <button class="icon-btn" onclick={cycleTheme} aria-label={t("theme.toggle")}><Icon name="dark-mode" /></button>
    </div>
  </div>
</div>
