// /api/log (action history) and /api/events (live updates, Server-Sent Events).

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentResult, DeviceAction, LogEntry, LogOutcome, Role } from "@awake/shared";
import { requireUser, type Env, type Services } from "./common.ts";

/** Streams end after this long so a revoked session cannot keep listening; EventSource reconnects. */
const STREAM_MAX_MS = 15 * 60_000;
const KEEPALIVE_MS = 25_000;

export function activityRoutes(s: Services) {
  const { db, bus } = s;
  const app = new Hono<Env>();
  app.use(requireUser(s));

  /**
   * House members see the whole log of their houses; users a device is shared with see their own
   * actions on it. Per-agent results only for house owners and editors.
   */
  app.get("/log", (c) => {
    const userId = c.var.auth.user.id;
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
    const houseId = c.req.query("houseId") ?? null;
    const rows = db
      .prepare(
        `SELECT l.*, hm.role FROM action_log l
           LEFT JOIN house_members hm ON hm.house_id = l.house_id AND hm.user_id = ?
         WHERE (hm.user_id IS NOT NULL
                OR (l.actor_user_id = ? AND l.device_id IN (SELECT device_id FROM device_shares WHERE user_id = ?)))
           AND (? IS NULL OR l.house_id = ?)
         ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
      )
      .all(userId, userId, userId, houseId, houseId, limit) as {
      id: number;
      created_at: number;
      device_id: string | null;
      device_name: string;
      house_id: string;
      house_name: string;
      actor_user_id: string | null;
      actor_username: string | null;
      source: "user" | "agent";
      action: DeviceAction;
      outcome: LogOutcome;
      online_after_ms: number | null;
      results: string | null;
      role: Role | null;
    }[];
    return c.json(
      rows.map(
        (r): LogEntry => ({
          id: r.id,
          at: r.created_at,
          deviceId: r.device_id,
          deviceName: r.device_name,
          houseId: r.house_id,
          houseName: r.house_name,
          actor: r.actor_username ? { id: r.actor_user_id, username: r.actor_username } : null,
          source: r.source,
          action: r.action,
          outcome: r.outcome,
          onlineAfterMs: r.online_after_ms,
          results: r.results && (r.role === "owner" || r.role === "editor") ? (JSON.parse(r.results) as AgentResult[]) : null,
        }),
      ),
    );
  });

  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      let done!: () => void;
      const finished = new Promise<void>((resolve) => (done = resolve));
      const unsubscribe = bus.subscribe(
        c.var.auth.user.id,
        (event) => void stream.writeSSE({ event: event.type, data: JSON.stringify(event) }),
        done,
      );
      stream.onAbort(done);
      const keepalive = setInterval(() => void stream.write(": keepalive\n\n"), KEEPALIVE_MS);
      const limit = setTimeout(done, STREAM_MAX_MS);
      await stream.writeSSE({ event: "ready", data: "{}" });
      await finished;
      clearInterval(keepalive);
      clearTimeout(limit);
      unsubscribe();
    }),
  );

  return app;
}
