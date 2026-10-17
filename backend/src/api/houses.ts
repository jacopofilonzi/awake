// /api/houses (houses, members, the house's agents) and /api/agents/:id.

import { Hono } from "hono";
import { z } from "zod";
import {
  HOUSE_ICONS,
  houseInputSchema,
  housePatchSchema,
  nameSchema,
  roleSchema,
  usernameSchema,
  type Agent,
  type AgentOutput,
  type AgentWithToken,
  type House,
  type HouseIcon,
  type HouseMember,
  type Role,
} from "@awake/shared";
import { atLeast, requireHouse } from "../access.ts";
import { agentDetails } from "../agents/details.ts";
import { loadUserByName } from "../auth/users.ts";
import { newId, transaction } from "../db.ts";
import { ApiError } from "../errors.ts";
import { hashToken, randomToken } from "../secrets.ts";
import { readBody, requireUser, type Env, type Services } from "./common.ts";

interface AgentRow {
  id: string;
  house_id: string;
  name: string;
  firmware: string | null;
  last_seen: number | null;
  info: string | null;
  info_at: number | null;
  created_at: number;
}

export function houseRoutes(s: Services) {
  const { db, hub, bus, devices } = s;
  const app = new Hono<Env>();
  app.use(requireUser(s));

  const toHouse = (houseId: string, userId: string): House => {
    const row = db
      .prepare("SELECT h.id, h.name, h.icon, h.created_at, hm.role FROM houses h JOIN house_members hm ON hm.house_id = h.id WHERE h.id = ? AND hm.user_id = ?")
      .get(houseId, userId) as unknown as HouseRow;
    return houseView(row);
  };

  /** `withDetails`: the viewer is an owner or editor of the house (diagnostics are theirs only). */
  const toAgent = (row: AgentRow, withDetails: boolean): Agent => {
    const outputs = db
      .prepare(
        `SELECT o.output_id, o.mode, o.has_long, o.is_on, d.id AS device_id FROM agent_outputs o
         LEFT JOIN devices d ON d.agent_id = o.agent_id AND d.output_id = o.output_id
         WHERE o.agent_id = ? AND o.present = 1 ORDER BY o.output_id`,
      )
      .all(row.id) as { output_id: string; mode: "button" | "switch"; has_long: number; is_on: number | null; device_id: string | null }[];
    return {
      id: row.id,
      houseId: row.house_id,
      name: row.name,
      online: hub.isOnline(row.id),
      firmware: row.firmware,
      lastSeen: row.last_seen,
      createdAt: row.created_at,
      details: withDetails ? agentDetails(db, hub, row) : null,
      outputs: outputs.map(
        (o): AgentOutput => ({
          id: o.output_id,
          mode: o.mode,
          long: o.mode === "button" && !!o.has_long,
          on: o.mode === "switch" && o.is_on !== null ? Boolean(o.is_on) : null,
          deviceId: o.device_id,
        }),
      ),
    };
  };

  const loadAgent = (agentId: string, userId: string, min: Role): AgentRow => {
    const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
    if (!row) throw new ApiError(404, "NOT_FOUND");
    requireHouse(db, userId, row.house_id, min);
    return row;
  };

  const ownerCount = (houseId: string) =>
    (db.prepare("SELECT COUNT(*) AS n FROM house_members WHERE house_id = ? AND role = 'owner'").get(houseId) as { n: number }).n;

  /** Devices of the house shared directly with a user: the user's view of them changes with membership. */
  const notifyHouseChange = (houseId: string, extraUsers: string[] = []) => {
    const users = [...bus.houseAudience(houseId), ...extraUsers];
    bus.toUsers(users, { type: "houses" });
    bus.toUsers(users, { type: "devices" });
  };

  // ---------- houses ----------

  app.get("/houses", (c) => {
    const rows = db
      .prepare("SELECT h.id, h.name, h.icon, h.created_at, hm.role FROM houses h JOIN house_members hm ON hm.house_id = h.id WHERE hm.user_id = ? ORDER BY h.name")
      .all(c.var.auth.user.id) as unknown as HouseRow[];
    return c.json(rows.map(houseView));
  });

  app.post("/houses", async (c) => {
    const { name, icon } = await readBody(c, houseInputSchema);
    const id = newId();
    const now = Date.now();
    transaction(db, () => {
      db.prepare("INSERT INTO houses (id, name, icon, created_at) VALUES (?, ?, ?, ?)").run(id, name, icon, now);
      db.prepare("INSERT INTO house_members (house_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(id, c.var.auth.user.id, now);
    });
    return c.json(toHouse(id, c.var.auth.user.id), 201);
  });

  app.patch("/houses/:id", async (c) => {
    const houseId = c.req.param("id");
    requireHouse(db, c.var.auth.user.id, houseId, "owner");
    const { name, icon } = await readBody(c, housePatchSchema);
    db.prepare("UPDATE houses SET name = COALESCE(?, name), icon = COALESCE(?, icon) WHERE id = ?").run(name ?? null, icon ?? null, houseId);
    notifyHouseChange(houseId, sharedUsers(houseId));
    return c.json(toHouse(houseId, c.var.auth.user.id));
  });

  /** Deletes the house with its agents (disconnected), devices, shares and log. */
  app.delete("/houses/:id", (c) => {
    const houseId = c.req.param("id");
    requireHouse(db, c.var.auth.user.id, houseId, "owner");
    const agents = db.prepare("SELECT id FROM agents WHERE house_id = ?").all(houseId) as { id: string }[];
    const deviceIds = db.prepare("SELECT id FROM devices WHERE house_id = ?").all(houseId) as { id: string }[];
    const audience = [...bus.houseAudience(houseId), ...sharedUsers(houseId)];
    db.prepare("DELETE FROM houses WHERE id = ?").run(houseId);
    for (const a of agents) hub.disconnect(a.id);
    for (const d of deviceIds) devices.forget(d.id);
    bus.toUsers(audience, { type: "houses" });
    bus.toUsers(audience, { type: "devices" });
    return c.body(null, 204);
  });

  const sharedUsers = (houseId: string) =>
    (
      db
        .prepare("SELECT DISTINCT s.user_id FROM device_shares s JOIN devices d ON d.id = s.device_id WHERE d.house_id = ?")
        .all(houseId) as { user_id: string }[]
    ).map((r) => r.user_id);

  // ---------- members ----------

  const members = (houseId: string): HouseMember[] =>
    (
      db
        .prepare(
          "SELECT hm.user_id, u.username, hm.role, hm.created_at FROM house_members hm JOIN users u ON u.id = hm.user_id WHERE hm.house_id = ? ORDER BY u.username",
        )
        .all(houseId) as { user_id: string; username: string; role: Role; created_at: number }[]
    ).map((r) => ({ userId: r.user_id, username: r.username, role: r.role, createdAt: r.created_at }));

  app.get("/houses/:id/members", (c) => {
    const houseId = c.req.param("id");
    requireHouse(db, c.var.auth.user.id, houseId, "member");
    return c.json(members(houseId));
  });

  app.post("/houses/:id/members", async (c) => {
    const houseId = c.req.param("id");
    requireHouse(db, c.var.auth.user.id, houseId, "owner");
    const body = await readBody(c, z.object({ username: usernameSchema, role: roleSchema }));
    const user = loadUserByName(db, body.username);
    if (!user || user.status !== "active") throw new ApiError(404, "USER_NOT_FOUND", "username");
    const exists = db.prepare("SELECT 1 FROM house_members WHERE house_id = ? AND user_id = ?").get(houseId, user.id);
    if (exists) throw new ApiError(409, "ALREADY_MEMBER", "username");
    transaction(db, () => {
      db.prepare("INSERT INTO house_members (house_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").run(houseId, user.id, body.role, Date.now());
      // House access supersedes direct shares of its devices.
      db.prepare("DELETE FROM device_shares WHERE user_id = ? AND device_id IN (SELECT id FROM devices WHERE house_id = ?)").run(user.id, houseId);
    });
    notifyHouseChange(houseId);
    return c.json(members(houseId), 201);
  });

  app.patch("/houses/:id/members/:userId", async (c) => {
    const houseId = c.req.param("id");
    const userId = c.req.param("userId");
    requireHouse(db, c.var.auth.user.id, houseId, "owner");
    const { role } = await readBody(c, z.object({ role: roleSchema }));
    const current = db.prepare("SELECT role FROM house_members WHERE house_id = ? AND user_id = ?").get(houseId, userId) as
      | { role: Role }
      | undefined;
    if (!current) throw new ApiError(404, "NOT_FOUND");
    if (current.role === "owner" && role !== "owner" && ownerCount(houseId) <= 1) throw new ApiError(409, "LAST_OWNER");
    db.prepare("UPDATE house_members SET role = ? WHERE house_id = ? AND user_id = ?").run(role, houseId, userId);
    notifyHouseChange(houseId);
    return c.json(members(houseId));
  });

  /** Owners remove members; anyone can leave (remove themselves). The last owner cannot leave. */
  app.delete("/houses/:id/members/:userId", (c) => {
    const houseId = c.req.param("id");
    const userId = c.req.param("userId");
    const self = userId === c.var.auth.user.id;
    requireHouse(db, c.var.auth.user.id, houseId, self ? "member" : "owner");
    const current = db.prepare("SELECT role FROM house_members WHERE house_id = ? AND user_id = ?").get(houseId, userId) as
      | { role: Role }
      | undefined;
    if (!current) throw new ApiError(404, "NOT_FOUND");
    if (current.role === "owner" && ownerCount(houseId) <= 1) throw new ApiError(409, "LAST_OWNER");
    db.prepare("DELETE FROM house_members WHERE house_id = ? AND user_id = ?").run(houseId, userId);
    notifyHouseChange(houseId, [userId]);
    return c.body(null, 204);
  });

  // ---------- agents ----------

  app.get("/houses/:id/agents", (c) => {
    const houseId = c.req.param("id");
    const role = requireHouse(db, c.var.auth.user.id, houseId, "member");
    const rows = db.prepare("SELECT * FROM agents WHERE house_id = ? ORDER BY name").all(houseId) as unknown as AgentRow[];
    const withDetails = atLeast(role, "editor");
    return c.json(rows.map((r) => toAgent(r, withDetails)));
  });

  app.post("/houses/:id/agents", async (c) => {
    const houseId = c.req.param("id");
    requireHouse(db, c.var.auth.user.id, houseId, "editor");
    const { name } = await readBody(c, z.object({ name: nameSchema }));
    const token = randomToken("awk_");
    const id = newId();
    db.prepare("INSERT INTO agents (id, house_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(id, houseId, name, hashToken(token), Date.now());
    const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as unknown as AgentRow;
    return c.json({ agent: toAgent(row, true), token } satisfies AgentWithToken, 201);
  });

  app.patch("/agents/:id", async (c) => {
    const row = loadAgent(c.req.param("id"), c.var.auth.user.id, "editor");
    const { name } = await readBody(c, z.object({ name: nameSchema }));
    db.prepare("UPDATE agents SET name = ? WHERE id = ?").run(name, row.id);
    return c.json(toAgent({ ...row, name }, true));
  });

  /** New token: the old one stops working and the agent is disconnected. */
  app.post("/agents/:id/token", (c) => {
    const row = loadAgent(c.req.param("id"), c.var.auth.user.id, "editor");
    const token = randomToken("awk_");
    db.prepare("UPDATE agents SET token_hash = ? WHERE id = ?").run(hashToken(token), row.id);
    hub.disconnect(row.id);
    return c.json({ agent: toAgent(row, true), token } satisfies AgentWithToken);
  });

  /** Deletes the agent: WoL devices lose it, output devices become unbound. */
  app.delete("/agents/:id", (c) => {
    const row = loadAgent(c.req.param("id"), c.var.auth.user.id, "editor");
    const affected = db
      .prepare("SELECT id FROM devices WHERE agent_id = ? UNION SELECT device_id FROM device_agents WHERE agent_id = ?")
      .all(row.id, row.id) as { id: string }[];
    db.prepare("DELETE FROM agents WHERE id = ?").run(row.id);
    hub.disconnect(row.id);
    for (const d of affected) devices.forget(d.id);
    bus.toHouse(row.house_id, { type: "agent", id: row.id, houseId: row.house_id, online: false });
    if (affected.length) notifyHouseChange(row.house_id, sharedUsers(row.house_id));
    return c.body(null, 204);
  });

  return app;
}

interface HouseRow {
  id: string;
  name: string;
  icon: string;
  created_at: number;
  role: Role;
}

// An icon dropped from HOUSE_ICONS in a later version must not break old rows.
const houseView = (r: HouseRow): House => ({
  id: r.id,
  name: r.name,
  icon: (HOUSE_ICONS as readonly string[]).includes(r.icon) ? (r.icon as HouseIcon) : "house",
  role: r.role,
  createdAt: r.created_at,
});
