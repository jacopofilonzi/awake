// /api/devices (list, status, actions, configuration, shares), /api/houses/:id/devices (create),
// /api/shared/:id (a recipient removes a device shared with them).

import { Hono } from "hono";
import { z } from "zod";
import {
  DEVICE_ICONS,
  deviceActionSchema,
  deviceInputSchema,
  usernameSchema,
  type Device,
  type DeviceAccess,
  type DeviceConfig,
  type DeviceIcon,
  type DeviceShare,
  type StatusMap,
} from "@awake/shared";
import { canManage, deviceAccess, requireDevice, requireHouse, type DeviceRow } from "../access.ts";
import { loadUserByName } from "../auth/users.ts";
import { isUniqueViolation, newId, transaction, type Db } from "../db.ts";
import { ApiError } from "../errors.ts";
import { readBody, requireUser, type Env, type Services } from "./common.ts";

type DeviceInput = z.infer<typeof deviceInputSchema>;

export function deviceRoutes(s: Services) {
  const { db, devices, bus } = s;
  const app = new Hono<Env>();
  app.use(requireUser(s));

  const toDevice = (row: DeviceRow & { house_name: string }, access: DeviceAccess): Device => ({
    id: row.id,
    houseId: row.house_id,
    houseName: row.house_name,
    name: row.name,
    icon: iconOf(row),
    access,
    kind: row.kind,
    actions: devices.actions(row),
    status: devices.statusOf(row),
    config: canManage(access) ? configOf(db, row) : null,
  });

  /** Every device the user reaches: through house memberships, then the ones shared directly. */
  const visible = (userId: string): { row: DeviceRow & { house_name: string }; access: DeviceAccess }[] => {
    const rows = db
      .prepare(
        `SELECT d.*, h.name AS house_name, hm.role AS access FROM devices d
           JOIN houses h ON h.id = d.house_id
           JOIN house_members hm ON hm.house_id = d.house_id AND hm.user_id = ?
         UNION ALL
         SELECT d.*, h.name AS house_name, 'shared' AS access FROM devices d
           JOIN houses h ON h.id = d.house_id
           JOIN device_shares s ON s.device_id = d.id AND s.user_id = ?
           WHERE NOT EXISTS (SELECT 1 FROM house_members hm WHERE hm.house_id = d.house_id AND hm.user_id = ?)
         ORDER BY house_name, name`,
      )
      .all(userId, userId, userId) as unknown as (DeviceRow & { house_name: string; access: DeviceAccess })[];
    return rows.map(({ access, ...row }) => ({ row, access }));
  };

  const withHouse = (row: DeviceRow) => ({
    ...row,
    house_name: (db.prepare("SELECT name FROM houses WHERE id = ?").get(row.house_id) as { name: string }).name,
  });

  /** Checks the agents referenced by the input belong to the house and the output is free. */
  const validateInput = (houseId: string, input: DeviceInput, deviceId: string | null) => {
    const inHouse = (agentId: string) => db.prepare("SELECT 1 FROM agents WHERE id = ? AND house_id = ?").get(agentId, houseId);
    if (input.action.type === "wol") {
      for (const id of input.action.agentIds) if (!inHouse(id)) throw new ApiError(400, "AGENT_NOT_IN_HOUSE", "action.agentIds");
      return;
    }
    if (!inHouse(input.action.agentId)) throw new ApiError(400, "AGENT_NOT_IN_HOUSE", "action.agentId");
    const output = db
      .prepare("SELECT 1 FROM agent_outputs WHERE agent_id = ? AND output_id = ? AND present = 1")
      .get(input.action.agentId, input.action.outputId);
    if (!output) throw new ApiError(400, "OUTPUT_NOT_FOUND", "action.outputId");
    const bound = db.prepare("SELECT id FROM devices WHERE agent_id = ? AND output_id = ?").get(input.action.agentId, input.action.outputId) as
      | { id: string }
      | undefined;
    if (bound && bound.id !== deviceId) throw new ApiError(409, "OUTPUT_IN_USE", "action.outputId");
  };

  const write = (deviceId: string, houseId: string, input: DeviceInput, create: boolean) => {
    const a = input.action;
    const cols = {
      name: input.name,
      icon: input.icon,
      kind: a.type,
      mac: a.type === "wol" ? a.mac : null,
      agent_id: a.type === "output" ? a.agentId : null,
      output_id: a.type === "output" ? a.outputId : null,
      ip: input.ip,
      probe_port: input.probePort,
    };
    try {
      transaction(db, () => {
        if (create) {
          db.prepare(
            "INSERT INTO devices (id, house_id, name, icon, kind, mac, agent_id, output_id, ip, probe_port, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(deviceId, houseId, cols.name, cols.icon, cols.kind, cols.mac, cols.agent_id, cols.output_id, cols.ip, cols.probe_port, Date.now());
        } else {
          db.prepare("UPDATE devices SET name = ?, icon = ?, kind = ?, mac = ?, agent_id = ?, output_id = ?, ip = ?, probe_port = ? WHERE id = ?").run(
            cols.name,
            cols.icon,
            cols.kind,
            cols.mac,
            cols.agent_id,
            cols.output_id,
            cols.ip,
            cols.probe_port,
            deviceId,
          );
          db.prepare("DELETE FROM device_agents WHERE device_id = ?").run(deviceId);
        }
        if (a.type === "wol") {
          const insert = db.prepare("INSERT INTO device_agents (device_id, agent_id) VALUES (?, ?)");
          for (const agentId of new Set(a.agentIds)) insert.run(deviceId, agentId);
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, "OUTPUT_IN_USE", "action.outputId");
      throw err;
    }
  };

  // ---------- list & status ----------

  app.get("/devices", (c) => c.json(visible(c.var.auth.user.id).map(({ row, access }) => toDevice(row, access))));

  /** Cached statuses only, never probes: poll this while a device is waking (or use /events). */
  app.get("/devices/status", (c) => {
    const statuses: StatusMap["statuses"] = {};
    for (const { row } of visible(c.var.auth.user.id)) statuses[row.id] = devices.statusOf(row);
    return c.json({ statuses } satisfies StatusMap);
  });

  /** Probes the visible devices (or `ids`), reusing results younger than the status cache. */
  app.post("/devices/check", async (c) => {
    const { ids } = await readBody(c, z.object({ ids: z.array(z.string()).max(200).optional() }));
    const wanted = ids ? new Set(ids) : null;
    const targets = visible(c.var.auth.user.id).filter(({ row }) => !wanted || wanted.has(row.id));
    const results = await Promise.all(targets.map(async ({ row }) => [row.id, await devices.check(row.id)] as const));
    return c.json({ statuses: Object.fromEntries(results) } satisfies StatusMap);
  });

  // ---------- actions ----------

  app.post("/devices/:id/action", async (c) => {
    const { device, access } = requireDevice(db, c.var.auth.user.id, c.req.param("id"), "use");
    const { action } = await readBody(c, z.object({ action: deviceActionSchema }));
    const { user } = c.var.auth;
    return c.json(await devices.act(device, action, { id: user.id, username: user.username }, canManage(access)));
  });

  // ---------- configuration ----------

  app.post("/houses/:id/devices", async (c) => {
    const houseId = c.req.param("id");
    const role = requireHouse(db, c.var.auth.user.id, houseId, "editor");
    const input = await readBody(c, deviceInputSchema);
    validateInput(houseId, input, null);
    const id = newId();
    write(id, houseId, input, true);
    bus.toHouse(houseId, { type: "devices" });
    const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as unknown as DeviceRow;
    return c.json(toDevice(withHouse(row), role), 201);
  });

  app.put("/devices/:id", async (c) => {
    const { device, access } = requireDevice(db, c.var.auth.user.id, c.req.param("id"), "manage");
    const input = await readBody(c, deviceInputSchema);
    validateInput(device.house_id, input, device.id);
    write(device.id, device.house_id, input, false);
    devices.forget(device.id);
    bus.toUsers(bus.deviceAudience(device.id), { type: "devices" });
    const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(device.id) as unknown as DeviceRow;
    return c.json(toDevice(withHouse(row), access));
  });

  app.delete("/devices/:id", (c) => {
    const { device } = requireDevice(db, c.var.auth.user.id, c.req.param("id"), "manage");
    const audience = bus.deviceAudience(device.id);
    db.prepare("DELETE FROM devices WHERE id = ?").run(device.id);
    devices.forget(device.id);
    bus.toUsers(audience, { type: "devices" });
    return c.body(null, 204);
  });

  // ---------- shares ----------

  const shares = (deviceId: string): DeviceShare[] =>
    (
      db
        .prepare(
          "SELECT s.user_id, u.username, s.created_at FROM device_shares s JOIN users u ON u.id = s.user_id WHERE s.device_id = ? ORDER BY u.username",
        )
        .all(deviceId) as { user_id: string; username: string; created_at: number }[]
    ).map((r) => ({ userId: r.user_id, username: r.username, createdAt: r.created_at }));

  app.get("/devices/:id/shares", (c) => {
    const { device } = requireDevice(db, c.var.auth.user.id, c.req.param("id"), "manage");
    return c.json(shares(device.id));
  });

  /** Shares a device with a user, who can see and use it right away (no acceptance step). */
  app.post("/devices/:id/shares", async (c) => {
    const { device } = requireDevice(db, c.var.auth.user.id, c.req.param("id"), "manage");
    const { username } = await readBody(c, z.object({ username: usernameSchema }));
    const user = loadUserByName(db, username);
    if (!user || user.status !== "active") throw new ApiError(404, "USER_NOT_FOUND", "username");
    if (user.id === c.var.auth.user.id) throw new ApiError(400, "CANNOT_TARGET_SELF", "username");
    const access = deviceAccess(db, user.id, device);
    if (access === "shared") throw new ApiError(409, "ALREADY_SHARED", "username");
    if (access) throw new ApiError(409, "ALREADY_HAS_ACCESS", "username");
    db.prepare("INSERT INTO device_shares (device_id, user_id, created_at) VALUES (?, ?, ?)").run(device.id, user.id, Date.now());
    bus.toUsers([user.id], { type: "devices" });
    return c.json(shares(device.id), 201);
  });

  app.delete("/devices/:id/shares/:userId", (c) => {
    const { device } = requireDevice(db, c.var.auth.user.id, c.req.param("id"), "manage");
    const userId = c.req.param("userId");
    const { changes } = db.prepare("DELETE FROM device_shares WHERE device_id = ? AND user_id = ?").run(device.id, userId);
    if (!changes) throw new ApiError(404, "NOT_FOUND");
    bus.toUsers([userId], { type: "devices" });
    return c.body(null, 204);
  });

  /** The recipient removes a shared device from their own list; the owner must share it again. */
  app.delete("/shared/:id", (c) => {
    const { changes } = db.prepare("DELETE FROM device_shares WHERE device_id = ? AND user_id = ?").run(c.req.param("id"), c.var.auth.user.id);
    if (!changes) throw new ApiError(404, "NOT_FOUND");
    return c.body(null, 204);
  });

  return app;
}

// An icon dropped from DEVICE_ICONS in a later version falls back to automatic instead of breaking old rows.
function iconOf(row: DeviceRow): DeviceIcon | null {
  return row.icon !== null && (DEVICE_ICONS as readonly string[]).includes(row.icon) ? (row.icon as DeviceIcon) : null;
}

function configOf(db: Db, row: DeviceRow): DeviceConfig {
  if (row.kind === "wol") {
    const agents = db.prepare("SELECT agent_id FROM device_agents WHERE device_id = ? ORDER BY agent_id").all(row.id) as { agent_id: string }[];
    return { ip: row.ip, probePort: row.probe_port, action: { type: "wol", mac: row.mac!, agentIds: agents.map((a) => a.agent_id) } };
  }
  // agent_id is null when the agent was deleted: the device must be bound to another output.
  return { ip: row.ip, probePort: row.probe_port, action: { type: "output", agentId: row.agent_id ?? "", outputId: row.output_id ?? "" } };
}
