<script lang="ts">
  import type { Snippet } from "svelte";
  import { i18n, setLocale, t } from "../lib/i18n/index.svelte.ts";
  import { cycleTheme, theme } from "../lib/theme.svelte.ts";
  import Icon from "./Icon.svelte";

  let { title, subtitle = "", children }: { title: string; subtitle?: string; children: Snippet } = $props();
</script>

<div class="grid min-h-dvh place-items-center p-4">
  <div class="w-full max-w-md">
    <div class="card px-6 py-8 sm:px-8">
      <div class="mb-6 flex items-center gap-2.5 font-display text-lg font-semibold">
        <span class="grid size-8 place-items-center rounded-[10px] bg-on-surface text-surface"><Icon name="power" size={17} /></span>Awake
      </div>
      <h1 class="text-[1.9rem] leading-tight">{title}</h1>
      {#if subtitle}<p class="mt-1 text-sm text-muted">{subtitle}</p>{/if}
      <div class="mt-6">{@render children()}</div>
    </div>
    <div class="mt-4 flex items-center justify-between px-2">
      <div class="flex gap-1 text-xs">
        {#each ["it", "en"] as const as l (l)}
          <button class="rounded-md px-2 py-1 uppercase {i18n.locale === l ? 'bg-on-surface text-surface' : 'text-muted hover:text-on-surface'}" onclick={() => setLocale(l)}>{l}</button>
        {/each}
      </div>
      <button class="icon-btn" onclick={cycleTheme} title={t(`theme.${theme.choice}`)} aria-label={t("theme.toggle")}><Icon name={theme.choice === "dark" ? "dark-mode" : theme.choice === "light" ? "light-mode" : "system-theme"} /></button>
    </div>
  </div>
</div>
