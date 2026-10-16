// Wiring: database, agent hub, device service, HTTP API and the /agent WebSocket upgrade.

import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "@hono/node-server";
import { AgentHub } from "./agents/hub.ts";
import { createApi } from "./api/index.ts";
import type { Env } from "./api/common.ts";
import { OAuthProviders } from "./auth/oauth.ts";
import { purgeExpired } from "./auth/sessions.ts";
import { bootstrapAdmin } from "./auth/users.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db.ts";
import { DeviceService } from "./devices/service.ts";
import { EventBus } from "./events.ts";
import { Limiters } from "./ratelimit.ts";
import { apiOnly, serveSpa } from "./static.ts";

export interface RunningServer {
  port: number;
  /** Password of the `admin` user created on an empty database; null when users already existed. */
  bootstrapPassword: string | null;
  close(): Promise<void>;
}

export async function startServer(config: Config): Promise<RunningServer> {
  const db = openDb(config.dataDir);

  // Wakes interrupted by a restart can no longer be verified.
  db.prepare("UPDATE action_log SET outcome = 'ok' WHERE outcome = 'waking'").run();
  purgeExpired(db);
  const purger = setInterval(() => purgeExpired(db), 60 * 60_000);
  purger.unref();

  const bootstrapPassword = await bootstrapAdmin(db);

  const limiters = new Limiters();
  const bus = new EventBus(db);
  const hub = new AgentHub(db, config.timing, limiters.agent);
  const devices = new DeviceService(db, hub, bus, config.timing);
  const oauth = new OAuthProviders(config);

  const app = new Hono<Env>();
  app.use(secureHeaders());
  app.route("/api", createApi({ config, db, hub, devices, bus, limiters, oauth }));
  app.all("/api/*", (c) => c.json({ error: "NOT_FOUND" }, 404));
  app.get("*", config.webDir ? serveSpa(config.webDir) : apiOnly(config.publicUrl));

  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: config.port }, () => resolve(s as Server)) as Server;
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/agent") {
      socket.destroy();
      return;
    }
    const hops = config.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",") : [];
    const ip = hops[hops.length - 1]?.trim() || req.socket.remoteAddress || "unknown";
    hub.wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws, ip));
  });

  return {
    port: (server.address() as AddressInfo).port,
    bootstrapPassword,
    close: async () => {
      clearInterval(purger);
      devices.close();
      hub.close();
      bus.closeAll();
      limiters.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
