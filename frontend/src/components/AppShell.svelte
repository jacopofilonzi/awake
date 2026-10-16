<script lang="ts">
  // Navigation: M3 navigation rail on wide screens, navigation bar at the bottom on phones.
  // The admin area uses the same shell with its own destinations and the muted warm scheme.
  import type { Snippet } from "svelte";
  import type { IconName } from "../lib/icons.ts";
  import { lastHouse } from "../lib/data.svelte.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link, router, type RouteName } from "../lib/router.svelte.ts";
  import { session } from "../lib/session.svelte.ts";
  import { cycleTheme, theme } from "../lib/theme.svelte.ts";
  import Icon from "./Icon.svelte";

  let { area, children }: { area: "app" | "admin"; children: Snippet } = $props();

  interface Dest {
    href: string;
    label: string;
    icon: IconName;
    active: IconName;
    routes: RouteName[];
  }

  const appDests = $derived<Dest[]>([
    {
      href: lastHouse() ? `/houses/${lastHouse()}` : "/",
      label: t("nav.home"),
      icon: "home",
      active: "home-fill",
      routes: ["home", "house", "house-agents", "house-members", "house-log", "device"],
    },
    { href: "/shared", label: t("nav.shared"), icon: "share", active: "share-fill", routes: ["shared"] },
    { href: "/activity", label: t("nav.activity"), icon: "history", active: "history-fill", routes: ["activity"] },
    { href: "/account", label: t("nav.account"), icon: "account", active: "account-fill", routes: ["account"] },
  ]);
  const adminDests: Dest[] = $derived([
    { href: "/admin", label: t("nav.users"), icon: "group", active: "group-fill", routes: ["admin-users"] },
    { href: "/admin/server", label: t("nav.server"), icon: "dns", active: "dns", routes: ["admin-server"] },
  ]);
  const dests = $derived(area === "admin" ? adminDests : appDests);
  const themeIcon = $derived<IconName>(theme.choice === "dark" ? "dark-mode" : theme.choice === "light" ? "light-mode" : "dark-mode");
</script>

<div class="{area === 'admin' ? 'scheme-admin' : ''} min-h-dvh bg-surface text-on-surface md:grid md:grid-cols-[5.5rem_1fr]">
  <nav class="sticky top-0 hidden h-dvh flex-col items-center gap-3 bg-surface-1 py-4 md:flex" aria-label={t("nav.main")}>
    <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-primary-container text-on-primary-container">
      <Icon name={area === "admin" ? "admin" : "power"} />
    </div>
    {#each dests as d (d.href)}
      {@const on = d.routes.includes(router.route.name)}
      <a href={d.href} use:link class="flex w-full flex-col items-center gap-1 text-xs font-medium text-on-surface-variant" aria-current={on ? "page" : undefined}>
        <span class="grid h-8 w-14 place-items-center rounded-full transition-colors {on ? 'bg-secondary-container text-on-secondary-container' : 'hover:bg-on-surface/8'}">
          <Icon name={on ? d.active : d.icon} />
        </span>
        {d.label}
      </a>
    {/each}
    <div class="mt-auto flex flex-col items-center gap-2">
      <button class="icon-btn" onclick={cycleTheme} title={t(`theme.${theme.choice}`)} aria-label={t("theme.toggle")}><Icon name={themeIcon} /></button>
      {#if area === "admin"}
        <a class="icon-btn" href="/" use:link title={t("admin.leave")} aria-label={t("admin.leave")}><Icon name="logout" /></a>
      {:else if session.user?.admin}
        <a class="icon-btn text-primary" href="/admin" use:link title={t("nav.admin")} aria-label={t("nav.admin")}><Icon name="admin" /></a>
      {/if}
    </div>
  </nav>

  <main class="min-w-0 pb-24 md:pb-0">{@render children()}</main>

  <nav class="fixed inset-x-0 bottom-0 z-20 grid h-20 grid-flow-col bg-surface-2 md:hidden" aria-label={t("nav.main")}>
    {#each dests as d (d.href)}
      {@const on = d.routes.includes(router.route.name)}
      <a href={d.href} use:link class="flex flex-col items-center justify-center gap-1 text-xs font-medium text-on-surface-variant" aria-current={on ? "page" : undefined}>
        <span class="grid h-8 w-16 place-items-center rounded-full {on ? 'bg-secondary-container text-on-secondary-container' : ''}"><Icon name={on ? d.active : d.icon} /></span>
        {d.label}
      </a>
    {/each}
    {#if area === "admin"}
      <a href="/" use:link class="flex flex-col items-center justify-center gap-1 text-xs font-medium text-on-surface-variant">
        <span class="grid h-8 w-16 place-items-center"><Icon name="logout" /></span>{t("admin.leaveShort")}
      </a>
    {/if}
  </nav>
</div>
