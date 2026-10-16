<script lang="ts">
  // M3 small top app bar: optional back button, title (or custom content), trailing actions.
  import type { Snippet } from "svelte";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link } from "../lib/router.svelte.ts";
  import Icon from "./Icon.svelte";

  let { title = "", back, leading, trailing }: { title?: string; back?: string; leading?: Snippet; trailing?: Snippet } = $props();
</script>

<header class="sticky top-0 z-10 flex h-16 items-center gap-1 bg-surface px-2 md:px-4">
  {#if back}<a class="icon-btn" href={back} use:link aria-label={t("common.back")}><Icon name="arrow-back" /></a>{/if}
  {#if leading}{@render leading()}{:else}<h1 class="truncate px-2 text-[1.375rem]">{title}</h1>{/if}
  <span class="flex-1"></span>
  {#if trailing}{@render trailing()}{/if}
</header>
