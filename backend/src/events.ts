// Live updates for connected UIs (GET /api/events). Each event is delivered only to the users who can
// see what it is about: the members of a house, plus the users a device is shared with.

import type { ServerEvent } from "@awake/shared";
import type { Db } from "./db.ts";

interface Subscriber {
  userId: string;
  send: (event: ServerEvent) => void;
  close: () => void;
}

export class EventBus {
  private subs = new Set<Subscriber>();

  constructor(private db: Db) {}

  subscribe(userId: string, send: Subscriber["send"], close: Subscriber["close"]): () => void {
    const sub = { userId, send, close };
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  /** Ends the streams of a user whose sessions were revoked (disabled, deleted, password changed). */
  closeUser(userId: string): void {
    for (const sub of this.subs) {
      if (sub.userId === userId) {
        this.subs.delete(sub);
        sub.close();
      }
    }
  }

  closeAll(): void {
    for (const sub of this.subs) sub.close();
    this.subs.clear();
  }

  toUsers(userIds: Iterable<string>, event: ServerEvent): void {
    if (this.subs.size === 0) return;
    const set = new Set(userIds);
    for (const sub of this.subs) if (set.has(sub.userId)) sub.send(event);
  }

  toHouse(houseId: string, event: ServerEvent): void {
    if (this.subs.size === 0) return;
    this.toUsers(this.houseAudience(houseId), event);
  }

  toDevice(deviceId: string, event: ServerEvent): void {
    if (this.subs.size === 0) return;
    this.toUsers(this.deviceAudience(deviceId), event);
  }

  houseAudience(houseId: string): string[] {
    const rows = this.db.prepare("SELECT user_id FROM house_members WHERE house_id = ?").all(houseId) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  deviceAudience(deviceId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT hm.user_id FROM devices d JOIN house_members hm ON hm.house_id = d.house_id WHERE d.id = ?
         UNION SELECT user_id FROM device_shares WHERE device_id = ?`,
      )
      .all(deviceId, deviceId) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }
}
