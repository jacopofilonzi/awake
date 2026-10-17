<script lang="ts">
  import { passwordSchema } from "@awake/shared";
  import AppShell from "../components/AppShell.svelte";
  import Icon from "../components/Icon.svelte";
  import Segmented from "../components/Segmented.svelte";
  import TextField from "../components/TextField.svelte";
  import TopBar from "../components/TopBar.svelte";
  import { api } from "../lib/api.ts";
  import { i18n, LANGUAGES, setLocale, t, type Key, type Locale } from "../lib/i18n/index.svelte.ts";
  import { clearQuery, router } from "../lib/router.svelte.ts";
  import { logout, session, setMe } from "../lib/session.svelte.ts";
  import { setTheme, theme, type ThemeChoice } from "../lib/theme.svelte.ts";
  import { confirmDialog, errorText, snack, snackError } from "../lib/ui.svelte.ts";

  const me = $derived(session.me!);
  const providers = $derived(session.config?.providers ?? []);

  // Back from linking a provider: ?linked=<id> or ?error=<code>.
  const q = router.route.query;
  if (q.has("linked")) snack(t("account.linked", { provider: session.config?.providers.find((p) => p.id === q.get("linked"))?.label ?? q.get("linked")! }));
  else if (q.has("error")) snack(t(`errors.${q.get("error")}` as Key));
  if (q.size) clearQuery();

  let current = $state("");
  let next = $state("");
  let confirm = $state("");
  let pwError = $state("");
  let busy = $state(false);

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    pwError = "";
    if (!passwordSchema.safeParse(next).success) return (pwError = t("errors.INVALID_PASSWORD"));
    if (next !== confirm) return (pwError = t("auth.passwordsDiffer"));
    busy = true;
    try {
      setMe(await api.auth.changePassword(me.user.hasPassword ? current : undefined, next));
      current = next = confirm = "";
      snack(t("account.passwordChanged"));
    } catch (err) {
      pwError = errorText(err);
    } finally {
      busy = false;
    }
  }

  async function unlink(provider: string, label: string) {
    const ok = await confirmDialog({ title: t("account.unlinkTitle"), text: t("account.unlinkText", { provider: label }), confirm: t("account.unlink"), danger: true });
    if (!ok) return;
    try {
      await api.auth.unlink(provider);
      setMe(await api.auth.me());
    } catch (err) {
      snackError(err);
    }
  }

  let locale = $state<Locale>(i18n.locale);
  let themeChoice = $state<ThemeChoice>(theme.choice);
  $effect(() => setLocale(locale));
  $effect(() => setTheme(themeChoice));
</script>

<AppShell area="app">
  <TopBar title={t("account.title")} />
  <div class="max-w-3xl space-y-3 px-4 pt-4 md:px-3">
    <section class="card flex items-center gap-4 p-5">
      <span class="grid size-14 place-items-center rounded-full bg-primary-container text-xl font-medium text-on-primary-container uppercase">{me.user.username[0]}</span>
      <div class="min-w-0 flex-1">
        <div class="text-xl">{me.user.username}</div>
        <div class="text-sm text-on-surface-variant">{me.user.admin ? t("account.admin") : t("account.user")}{me.user.email ? ` · ${me.user.email}` : ""}</div>
      </div>
      <button class="btn-outlined" onclick={logout}><Icon name="logout" size={20} />{t("account.logout")}</button>
    </section>

    <section class="card-outlined p-5">
      <h2 class="text-base font-medium">{me.user.hasPassword ? t("account.changePassword") : t("account.setPassword")}</h2>
      <p class="mb-4 text-sm text-on-surface-variant">{t("account.passwordHint")}</p>
      <form class="grid gap-4 sm:grid-cols-2" onsubmit={changePassword}>
        {#if me.user.hasPassword}
          <div class="sm:col-span-2"><TextField label={t("auth.currentPassword")} type="password" bind:value={current} autocomplete="current-password" /></div>
        {/if}
        <TextField label={t("auth.newPassword")} type="password" bind:value={next} autocomplete="new-password" hint={t("auth.passwordHint")} />
        <TextField label={t("auth.confirmPassword")} type="password" bind:value={confirm} autocomplete="new-password" />
        {#if pwError}<p class="text-sm text-error sm:col-span-2" role="alert">{pwError}</p>{/if}
        <div class="sm:col-span-2"><button class="btn-tonal" disabled={busy || !next}>{t("common.save")}</button></div>
      </form>
    </section>

    {#if providers.length || me.identities.length}
      <section class="card-outlined p-5">
        <h2 class="text-base font-medium">{t("account.identities")}</h2>
        <p class="mb-2 text-sm text-on-surface-variant">{t("account.identitiesHint")}</p>
        <ul>
          {#each providers as p (p.id)}
            {@const linked = me.identities.find((i) => i.provider === p.id)}
            <li class="flex items-center gap-3 border-t border-on-surface/8 py-3 first:border-t-0">
              <span class="grid size-9 place-items-center rounded-full bg-glass-strong text-sm font-semibold">{p.label[0]}</span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium">{p.label}</div>
                <div class="truncate text-xs text-on-surface-variant">{linked ? (linked.email ?? t("account.linkedNoEmail")) : t("account.notLinked")}</div>
              </div>
              {#if linked}
                <button class="btn-text" onclick={() => unlink(p.id, p.label)}>{t("account.unlink")}</button>
              {:else}
                <a class="btn-tonal" href={api.auth.oauthUrl(p.id, "link", "/account")}><Icon name="link" size={20} />{t("account.link")}</a>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="card-outlined space-y-4 p-5">
      <h2 class="text-base font-medium">{t("account.preferences")}</h2>
      <div>
        <label class="field-label" for="language">{t("account.language")}</label>
        <select id="language" class="input sm:max-w-xs" bind:value={locale}>
          {#each LANGUAGES as l (l.locale)}<option value={l.locale}>{l.name}</option>{/each}
        </select>
      </div>
      <div>
        <span class="field-label">{t("account.theme")}</span>
        <Segmented
          label={t("account.theme")}
          bind:value={themeChoice}
          options={[
            { value: "system", label: t("theme.system") },
            { value: "light", label: t("theme.light") },
            { value: "dark", label: t("theme.dark") },
          ]}
        />
      </div>
    </section>
  </div>
</AppShell>
