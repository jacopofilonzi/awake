<script lang="ts">
  import Feedback from "./components/Feedback.svelte";
  import { data, loadAll } from "./lib/data.svelte.ts";
  import { t } from "./lib/i18n/index.svelte.ts";
  import { navigate, router } from "./lib/router.svelte.ts";
  import { boot, session } from "./lib/session.svelte.ts";
  import { snackError } from "./lib/ui.svelte.ts";
  import Account from "./pages/Account.svelte";
  import Activity from "./pages/Activity.svelte";
  import AdminServer from "./pages/admin/Server.svelte";
  import AdminUsers from "./pages/admin/Users.svelte";
  import ChangePassword from "./pages/ChangePassword.svelte";
  import Device from "./pages/Device.svelte";
  import Home from "./pages/Home.svelte";
  import House from "./pages/House.svelte";
  import Login from "./pages/Login.svelte";
  import Register from "./pages/Register.svelte";
  import SetPassword from "./pages/SetPassword.svelte";
  import Shared from "./pages/Shared.svelte";

  const PUBLIC = ["login", "register", "set-password"];

  let bootError = $state(false);
  boot().catch(() => (bootError = true));

  const user = $derived(session.user);
  const route = $derived(router.route.name);

  // Routing guards: anonymous users go to /login, logged-in users leave the auth pages.
  $effect(() => {
    if (!session.ready) return;
    if (!user && !PUBLIC.includes(route)) navigate("/login", { replace: true });
    else if (user && (route === "login" || route === "register")) navigate("/", { replace: true });
    else if (user && route.startsWith("admin") && !user.admin) navigate("/", { replace: true });
  });

  // Houses and devices once logged in (and the password no longer has to be changed).
  $effect(() => {
    if (user && !user.mustChangePassword && !data.loaded) loadAll().catch(snackError);
  });
</script>

{#if bootError}
  <div class="grid min-h-dvh place-items-center p-6 text-center text-on-surface-variant">{t("errors.NETWORK")}</div>
{:else if !session.ready}
  <div class="min-h-dvh bg-surface"></div>
{:else if route === "set-password"}
  <SetPassword />
{:else if !user}
  {#if route === "register"}<Register />{:else}<Login />{/if}
{:else if user.mustChangePassword}
  <ChangePassword />
{:else if route === "house" || route === "house-agents" || route === "house-members" || route === "house-log"}
  <House />
{:else if route === "device"}
  <Device />
{:else if route === "shared"}
  <Shared />
{:else if route === "activity"}
  <Activity />
{:else if route === "account"}
  <Account />
{:else if route === "admin-users" && user.admin}
  <AdminUsers />
{:else if route === "admin-server" && user.admin}
  <AdminServer />
{:else}
  <Home />
{/if}

<Feedback />
