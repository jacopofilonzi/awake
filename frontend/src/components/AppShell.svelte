<script lang="ts">
  // Navigation. Wide screens: a floating glass sidebar with the houses (devices on / total), your
  // pages, administration and the account; the current house shows its sections under it. Phones: a
  // slim header (logo, theme, account menu) and a floating dock at the bottom with the sections of the
  // current (or last) house, then shared and activity (navigation only: page actions float above it).
  // The admin area uses the same shell with its own destinations and the slate accent.
  import type { Snippet } from "svelte";
  import HouseDialog from "../dialogs/HouseDialog.svelte";
  import type { IconName } from "../lib/icons.ts";
  import { data, lastHouse } from "../lib/data.svelte.ts";
  import { isLit } from "../lib/format.ts";
  import { t } from "../lib/i18n/index.svelte.ts";
  import { link, navigate, router, type RouteName } from "../lib/router.svelte.ts";
  import { logout, session } from "../lib/session.svelte.ts";
  import { cycleTheme, theme } from "../lib/theme.svelte.ts";
  import Icon from "./Icon.svelte";
  import Menu from "./Menu.svelte";
  import MenuItem from "./MenuItem.svelte";

  let { area, children }: { area: "app" | "admin"; children: Snippet } = $props();

  interface Dest {
    href: string;
    label: string;
    icon: IconName;
    routes: RouteName[];
  }

  const route = $derived(router.route.name);
  // The house being shown: from the URL, or the device's house on a device page.
  const currentHouse = $derived(
    route === "device" ? data.devices.find((d) => d.id === router.route.params.id)?.houseId : router.route.params.id,
  );
  // Sections link to the house on screen, or to the last one visited from the other pages.
  const sectionHouse = $derived(currentHouse ?? lastHouse() ?? data.houses[0]?.id ?? null);
  const sections = $derived<Dest[]>(
    sectionHouse
      ? [
          { href: `/houses/${sectionHouse}`, label: t("house.tabs.devices"), icon: "devices", routes: ["home", "house", "device"] },
          { href: `/houses/${sectionHouse}/agents`, label: t("house.tabs.agents"), icon: "router", routes: ["house-agents"] },
          { href: `/houses/${sectionHouse}/members`, label: t("house.tabs.members"), icon: "group", routes: ["house-members"] },
          { href: `/houses/${sectionHouse}/log`, label: t("house.tabs.log"), icon: "history", routes: ["house-log"] },
        ]
      : [{ href: "/", label: t("nav.home"), icon: "home", routes: ["home"] }],
  );
  const youDests = $derived<Dest[]>([
    { href: "/shared", label: t("nav.shared"), icon: "share", routes: ["shared"] },
    { href: "/activity", label: t("nav.activity"), icon: "activity", routes: ["activity"] },
  ]);
  const adminDests = $derived<Dest[]>([
    { href: "/admin", label: t("nav.users"), icon: "group", routes: ["admin-users"] },
    { href: "/admin/server", label: t("nav.server"), icon: "dns", routes: ["admin-server"] },
  ]);
  const themeIcon = $derived<IconName>(theme.choice === "dark" ? "dark-mode" : theme.choice === "light" ? "light-mode" : "system-theme");
  const initial = $derived((session.user?.username ?? "?").slice(0, 1).toUpperCase());

  let newHouse = $state(false);

  const lit = (houseId: string) => {
    const ds = data.devicesOf(houseId);
    return { on: ds.filter(isLit).length, n: ds.length };
  };
</script>

{#snippet themeButton(cls = "")}
  <button class="icon-btn {cls}" onclick={cycleTheme} title={t(`theme.${theme.choice}`)} aria-label={t("theme.toggle")}><Icon name={themeIcon} /></button>
{/snippet}

{#snippet logo()}
  <span class="grid size-8 place-items-center rounded-[10px] {area === 'admin' ? 'bg-primary text-on-primary' : 'bg-on-surface text-surface'}">
    <Icon name={area === "admin" ? "admin" : "power"} size={17} />
  </span>
{/snippet}

{#snippet navLink(d: Dest, count?: number)}
  {@const on = d.routes.includes(route)}
  <a
    href={d.href}
    use:link
    class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors {on ? 'bg-glass-strong text-on-surface' : 'text-muted hover:bg-glass-strong hover:text-on-surface'}"
    aria-current={on ? "page" : undefined}
  >
    <Icon name={d.icon} size={18} />{d.label}
    {#if count}<span class="ml-auto text-xs font-medium text-muted">{count}</span>{/if}
  </a>
{/snippet}

<div class="{area === 'admin' ? 'scheme-admin' : ''} min-h-dvh text-on-surface md:grid md:grid-cols-[17rem_1fr] md:gap-3 md:p-3">
  <!-- wide: sidebar -->
  <nav class="glass sticky top-3 hidden h-[calc(100dvh-1.5rem)] flex-col gap-1 overflow-y-auto rounded-[22px] p-3 md:flex" aria-label={t("nav.main")}>
    <div class="flex items-center gap-2.5 px-1.5 pb-3">
      {@render logo()}
      <span class="font-display text-lg font-semibold">{area === "admin" ? t("nav.admin") : "Awake"}</span>
      <span class="flex-1"></span>
      {@render themeButton("size-8")}
    </div>

    {#if area === "app"}
      <div class="px-3 pt-1 pb-1.5 text-[0.7rem] font-bold tracking-wider text-muted uppercase">{t("nav.houses")}</div>
      {#each data.houses as h (h.id)}
        {@const c = lit(h.id)}
        {@const on = h.id === currentHouse}
        <a
          href="/houses/{h.id}"
          use:link
          class="flex items-center gap-2.5 rounded-[14px] p-2 text-sm font-semibold transition-colors {on ? 'bg-surface-1 text-on-surface shadow-soft dark:bg-glass-strong' : 'text-on-surface-variant hover:bg-glass-strong'}"
          aria-current={on ? "page" : undefined}
        >
          <span class="grid size-8 shrink-0 place-items-center rounded-[10px] {on ? 'bg-primary-container text-on-primary-container' : 'bg-glass-strong'}"><Icon name="home" size={17} /></span>
          <span class="min-w-0 flex-1 truncate">{h.name}</span>
          <span class="text-xs font-medium text-muted" title={t("nav.devicesOn", c)}>{c.on}/{c.n}</span>
        </a>
        {#if on}
          <div class="mb-1 ml-[1.35rem] flex flex-col gap-0.5 border-l border-on-surface/10 pl-2">
            {#each sections as d (d.href)}
              {@const here = d.routes.includes(route)}
              <a
                href={d.href}
                use:link
                class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-semibold transition-colors {here ? 'bg-glass-strong text-on-surface' : 'text-muted hover:text-on-surface'}"
                aria-current={here ? "page" : undefined}
              >
                <Icon name={d.icon} size={16} />{d.label}
              </a>
            {/each}
          </div>
        {/if}
      {/each}
      <button class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted hover:bg-glass-strong hover:text-on-surface" onclick={() => (newHouse = true)}>
        <Icon name="add" size={18} />{t("house.newTitle")}
      </button>

      <div class="px-3 pt-4 pb-1.5 text-[0.7rem] font-bold tracking-wider text-muted uppercase">{t("nav.you")}</div>
      {@render navLink(youDests[0]!, data.shared.length)}
      {@render navLink(youDests[1]!)}
      {#if session.user?.admin}
        <a href="/admin" use:link class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted hover:bg-glass-strong hover:text-on-surface">
          <Icon name="admin" size={18} />{t("nav.admin")}
        </a>
      {/if}

      <a
        href="/account"
        use:link
        class="mt-auto flex items-center gap-2.5 rounded-2xl p-2 transition-colors {route === 'account' ? 'bg-glass-strong' : 'hover:bg-glass-strong'}"
        aria-current={route === "account" ? "page" : undefined}
      >
        <span class="grid size-9 place-items-center rounded-full bg-primary-container font-bold text-on-primary-container">{initial}</span>
        <span class="grid min-w-0 leading-tight"><b class="truncate text-sm">{session.user?.username}</b><span class="text-xs text-muted">{t("nav.account")}</span></span>
      </a>
    {:else}
      {#each adminDests as d (d.href)}{@render navLink(d)}{/each}
      <a href="/" use:link class="mt-auto flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted hover:bg-glass-strong hover:text-on-surface">
        <Icon name="arrow-back" size={18} />{t("admin.leave")}
      </a>
    {/if}
  </nav>

  <div class="min-w-0">
    <!-- phones: header -->
    <header class="flex items-center gap-2 px-4 pt-3 md:hidden">
      {@render logo()}
      <span class="font-display text-[1.05rem] font-semibold">{area === "admin" ? t("nav.admin") : "Awake"}</span>
      <span class="flex-1"></span>
      {@render themeButton()}
      <Menu align="right" title={session.user?.username}>
        {#snippet trigger(toggle, open)}
          <button class="grid size-9 place-items-center rounded-full bg-primary-container font-bold text-on-primary-container" onclick={toggle} aria-expanded={open} aria-label={t("nav.account")}>{initial}</button>
        {/snippet}
        <MenuItem label={t("nav.account")} icon="account" href="/account" />
        {#if area === "admin"}
          <MenuItem label={t("admin.leave")} icon="arrow-back" href="/" />
        {:else if session.user?.admin}
          <MenuItem label={t("nav.admin")} icon="admin" href="/admin" />
        {/if}
        <MenuItem label={t("account.logout")} icon="logout" onclick={logout} />
      </Menu>
    </header>

    <main class="min-w-0 pb-28 md:pb-6">{@render children()}</main>
  </div>

  <!-- phones: dock -->
  <nav class="glass fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-[22px] p-1.5 md:hidden" aria-label={t("nav.main")}>
    {#snippet dockLink(d: Dest)}
      {@const on = d.routes.includes(route)}
      <a
        href={d.href}
        use:link
        class="grid h-12 w-12 place-items-center rounded-2xl transition-colors {on ? 'bg-surface-1 text-on-surface shadow-soft dark:bg-glass-strong' : 'text-muted'}"
        aria-current={on ? "page" : undefined}
        aria-label={d.label}
        title={d.label}
      >
        <Icon name={d.icon} size={22} />
      </a>
    {/snippet}
    {#if area === "admin"}
      {#each adminDests as d (d.href)}{@render dockLink(d)}{/each}
    {:else}
      {#each sections as d (d.href)}{@render dockLink(d)}{/each}
      <span class="mx-0.5 my-2.5 w-px bg-on-surface/12" aria-hidden="true"></span>
      {#each youDests as d (d.href)}{@render dockLink(d)}{/each}
    {/if}
  </nav>
</div>

<HouseDialog open={newHouse} onclose={() => (newHouse = false)} oncreated={(h) => navigate(`/houses/${h.id}`)} />
