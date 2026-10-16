<script lang="ts">
  import AppShell from "../../components/AppShell.svelte";
  import Icon from "../../components/Icon.svelte";
  import TopBar from "../../components/TopBar.svelte";
  import { t } from "../../lib/i18n/index.svelte.ts";
  import { session } from "../../lib/session.svelte.ts";

  const cfg = $derived(session.config);
  const registration = $derived(
    !cfg?.registration.enabled ? t("admin.server.regClosed") : cfg.registration.autoApprove ? t("admin.server.regOpen") : t("admin.server.regApproval"),
  );
</script>

<AppShell area="admin">
  <TopBar title={t("admin.title")} />
  <div class="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
    <h2 class="text-[1.375rem]">{t("nav.server")}</h2>
    <section class="card-outlined p-5">
      <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt class="text-on-surface-variant">{t("admin.server.version")}</dt><dd class="text-right font-mono">{cfg?.version ?? "—"}</dd>
        <dt class="text-on-surface-variant">{t("admin.server.protocol")}</dt><dd class="text-right font-mono">v{cfg?.protocolVersion ?? "—"}</dd>
        <dt class="text-on-surface-variant">{t("admin.server.address")}</dt><dd class="text-right font-mono">{location.origin}</dd>
        <dt class="text-on-surface-variant">{t("admin.server.registration")}</dt><dd class="text-right">{registration}</dd>
        <dt class="text-on-surface-variant">{t("admin.server.providers")}</dt>
        <dd class="text-right">{cfg?.providers.map((p) => p.label).join(", ") || t("admin.server.noProviders")}</dd>
      </dl>
    </section>
    <p class="flex gap-2 text-sm text-on-surface-variant"><Icon name="info" size={20} />{t("admin.server.readOnly")}</p>
  </div>
</AppShell>
