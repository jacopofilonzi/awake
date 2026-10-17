<script lang="ts">
  import type { Snippet } from "svelte";
  import { i18n, LANGUAGES, setLocale, t, type Locale } from "../lib/i18n/index.svelte.ts";
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
      <label class="flex items-center gap-1.5 text-sm text-muted">
        <Icon name="translate" size={16} />
        <select class="rounded-lg bg-transparent py-1 pr-1 font-medium text-on-surface-variant outline-none hover:text-on-surface" value={i18n.locale} onchange={(e) => setLocale(e.currentTarget.value as Locale)} aria-label={t("account.language")}>
          {#each LANGUAGES as l (l.locale)}<option value={l.locale}>{l.name}</option>{/each}
        </select>
      </label>
      <button class="icon-btn" onclick={cycleTheme} title={t(`theme.${theme.choice}`)} aria-label={t("theme.toggle")}><Icon name={theme.choice === "dark" ? "dark-mode" : theme.choice === "light" ? "light-mode" : "system-theme"} /></button>
    </div>
  </div>
</div>
