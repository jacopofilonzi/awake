// Houses and devices visible to the user, kept current by the live event stream (GET /api/events).
// Pages read from here; anything house-specific that is not here (agents, members, log) is fetched by
// the page itself and refetched when `data.version` bumps for that house.

import type { Device, DeviceStatus, House, ServerEvent } from "@awake/shared";
import { api, API_BASE } from "./api.ts";
import { load, save } from "./storage.ts";

class Data {
  houses = $state<House[]>([]);
  devices = $state<Device[]>([]);
  loaded = $state(false);
  /** Bumped per house when its agents/members change, so open pages refetch. */
  version = $state<Record<string, number>>({});
  live = $state(false);
  /** Bumped after every action, so activity lists refetch (a press changes no status). */
  actions = $state(0);

  house(id: string | undefined): House | undefined {
    return this.houses.find((h) => h.id === id);
  }

  devicesOf(houseId: string): Device[] {
    return this.devices.filter((d) => d.houseId === houseId && d.access !== "shared");
  }

  get shared(): Device[] {
    return this.devices.filter((d) => d.access === "shared");
  }

  reset(): void {
    stopLive();
    this.houses = [];
    this.devices = [];
    this.loaded = false;
    this.version = {};
  }
}

export const data = new Data();

export async function loadAll(): Promise<void> {
  const [houses, devices] = await Promise.all([api.houses.list(), api.devices.list()]);
  data.houses = houses;
  data.devices = devices;
  data.loaded = true;
  startLive();
}

export async function reloadDevices(): Promise<void> {
  data.devices = await api.devices.list();
}

export async function reloadHouses(): Promise<void> {
  data.houses = await api.houses.list();
}

export function setStatus(id: string, status: DeviceStatus): void {
  const d = data.devices.find((x) => x.id === id);
  if (d) d.status = status;
}

export function bump(houseId: string): void {
  data.version = { ...data.version, [houseId]: (data.version[houseId] ?? 0) + 1 };
}

/** Probes the given devices (results younger than ~10 s are reused by the server). */
export async function checkDevices(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { statuses } = await api.devices.check(ids);
  for (const [id, status] of Object.entries(statuses)) setStatus(id, status);
}

// ---------- last visited house ----------

export function rememberHouse(id: string): void {
  save("lastHouse", id);
}
export function lastHouse(): string | null {
  return load("lastHouse");
}

// ---------- live events ----------

let source: EventSource | null = null;

function startLive(): void {
  if (source) return;
  source = new EventSource(`${API_BASE}/events`);
  source.addEventListener("open", () => (data.live = true));
  source.addEventListener("error", () => (data.live = false));
  const on = (type: ServerEvent["type"], fn: (e: ServerEvent) => void) =>
    source!.addEventListener(type, (m) => fn(JSON.parse((m as MessageEvent).data)));
  on("device", (e) => e.type === "device" && setStatus(e.id, e.status));
  on("devices", () => void reloadDevices());
  on("houses", () => void reloadHouses());
  on("agent", (e) => {
    if (e.type !== "agent") return;
    bump(e.houseId);
  });
}

function stopLive(): void {
  source?.close();
  source = null;
  data.live = false;
}
