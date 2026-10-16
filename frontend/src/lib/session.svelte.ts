// Who is logged in and the server's public configuration.

import type { Me, PublicConfig } from "@awake/shared";
import { api, ApiFailure, setUnauthorizedHandler } from "./api.ts";
import { data } from "./data.svelte.ts";
import { navigate } from "./router.svelte.ts";

class Session {
  config = $state<PublicConfig | null>(null);
  me = $state<Me | null>(null);
  ready = $state(false);

  get user() {
    return this.me?.user ?? null;
  }
}

export const session = new Session();

export async function boot(): Promise<void> {
  setUnauthorizedHandler(() => {
    if (!session.me) return;
    session.me = null;
    data.reset();
    navigate("/login", { replace: true });
  });
  const [config, me] = await Promise.all([
    api.config().catch(() => null),
    api.auth.me().catch((err) => {
      if (err instanceof ApiFailure && (err.status === 401 || err.code === "PASSWORD_CHANGE_REQUIRED")) return null;
      throw err;
    }),
  ]);
  session.config = config;
  session.me = me;
  session.ready = true;
}

export function setMe(me: Me): void {
  session.me = me;
}

export async function logout(): Promise<void> {
  await api.auth.logout().catch(() => {});
  session.me = null;
  data.reset();
  navigate("/login", { replace: true });
}
