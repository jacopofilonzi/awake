import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { PROTOCOL_VERSION, type PublicConfig } from "@awake/shared";
import { ApiError } from "../errors.ts";
import { log } from "../log.ts";
import { getSettings } from "../settings.ts";
import { VERSION } from "../version.ts";
import { activityRoutes } from "./activity.ts";
import { adminRoutes } from "./admin.ts";
import { authRoutes } from "./auth.ts";
import { sameOrigin, type Env, type Services } from "./common.ts";
import { deviceRoutes } from "./devices.ts";
import { houseRoutes } from "./houses.ts";

export function createApi(s: Services) {
  const api = new Hono<Env>();

  api.use(sameOrigin(s.config));
  api.use(bodyLimit({ maxSize: 64 * 1024, onError: () => Promise.reject(new ApiError(400, "VALIDATION")) }));

  api.get("/health", (c) => c.json({ ok: true }));
  api.get("/config", (c) =>
    c.json({
      version: VERSION,
      protocolVersion: PROTOCOL_VERSION,
      registration: (({ registrationEnabled, autoApprove }) => ({ enabled: registrationEnabled, autoApprove }))(getSettings(s.db)),
      providers: s.oauth.listEnabled(),
    } satisfies PublicConfig),
  );

  api.route("/auth", authRoutes(s));
  api.route("/admin", adminRoutes(s));
  // These sub-apps own disjoint paths under /api.
  api.route("/", houseRoutes(s));
  api.route("/", deviceRoutes(s));
  api.route("/", activityRoutes(s));

  api.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.toBody(), err.status);
    log.error("api", "unhandled error", { method: c.req.method, path: c.req.path, err: err.stack ?? err });
    return c.json({ error: "INTERNAL" }, 500);
  });

  return api;
}
