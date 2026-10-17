<script lang="ts">
  // Page header: optional back button, title (or custom content), trailing actions.
  import type { Snippet } from "svelte";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link } from "../lib/router.svelte.ts";
  import Icon from "./Icon.svelte";

  let { title = "", back, leading, trailing }: { title?: string; back?: string; leading?: Snippet; trailing?: Snippet } = $props();
</script>

<header class="flex min-h-16 items-center gap-2 px-4 pt-4 md:px-3 md:pt-5">
  {#if back}<a class="icon-btn -ml-1 bg-glass-strong" href={back} use:link aria-label={t("common.back")}><Icon name="arrow-back" /></a>{/if}
  {#if leading}{@render leading()}{:else}<h1 class="truncate text-[2rem] leading-tight md:text-[2.4rem]">{title}</h1>{/if}
  <span class="flex-1"></span>
  {#if trailing}{@render trailing()}{/if}
</header>
