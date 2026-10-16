// Who can do what. A user reaches a device either through a house membership (role owner, editor or
// member) or because the device was shared with them directly ("shared": use only).
//
// | Capability                              | owner | editor | member | shared |
// |-----------------------------------------|-------|--------|--------|--------|
// | see devices and their status, act       |   ✓   |   ✓    |   ✓    |   ✓    |
// | see device config (MAC, IP), agents      |   ✓   |   ✓    |        |        |
// | manage agents, devices, device shares   |   ✓   |   ✓    |        |        |
// | manage members, rename/delete the house |   ✓   |        |        |        |
//
// A resource the user cannot see at all is reported as NOT_FOUND, never FORBIDDEN, so ids of other
// people's houses and devices are not revealed.

import type { DeviceAccess, Role } from "@awake/shared";
import type { Db } from "./db.ts";
import { ApiError } from "./errors.ts";

const RANK: Record<Role, number> = { member: 1, editor: 2, owner: 3 };

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export function houseRole(db: Db, userId: string, houseId: string): Role | null {
  const row = db.prepare("SELECT role FROM house_members WHERE house_id = ? AND user_id = ?").get(houseId, userId) as
    | { role: Role }
    | undefined;
  return row?.role ?? null;
}

/** Throws NOT_FOUND without any role, FORBIDDEN with a role below `min`. */
export function requireHouse(db: Db, userId: string, houseId: string, min: Role): Role {
  const role = houseRole(db, userId, houseId);
  if (!role) throw new ApiError(404, "NOT_FOUND");
  if (!atLeast(role, min)) throw new ApiError(403, "FORBIDDEN");
  return role;
}

export interface DeviceRow {
  id: string;
  house_id: string;
  name: string;
  kind: "wol" | "output";
  mac: string | null;
  agent_id: string | null;
  output_id: string | null;
  ip: string | null;
  probe_port: number | null;
  created_at: number;
}

export function loadDevice(db: Db, deviceId: string): DeviceRow | undefined {
  return db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId) as DeviceRow | undefined;
}

export function deviceAccess(db: Db, userId: string, device: DeviceRow): DeviceAccess | null {
  const role = houseRole(db, userId, device.house_id);
  if (role) return role;
  const shared = db.prepare("SELECT 1 FROM device_shares WHERE device_id = ? AND user_id = ?").get(device.id, userId);
  return shared ? "shared" : null;
}

export function canManage(access: DeviceAccess): boolean {
  return access === "owner" || access === "editor";
}

/** "use": any access. "manage": house owner or editor. */
export function requireDevice(db: Db, userId: string, deviceId: string, need: "use" | "manage"): { device: DeviceRow; access: DeviceAccess } {
  const device = loadDevice(db, deviceId);
  const access = device ? deviceAccess(db, userId, device) : null;
  if (!device || !access) throw new ApiError(404, "NOT_FOUND");
  if (need === "manage" && !canManage(access)) throw new ApiError(403, "FORBIDDEN");
  return { device, access };
}
