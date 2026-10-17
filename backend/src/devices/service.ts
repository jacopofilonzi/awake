// Device status and actions.
//
// Status has two independent parts:
// - reach (online/offline/waking), from probes sent through the agents. Probes run only when a user
//   asks (POST /devices/check) or after a wake: there is no periodic background polling. Results are
//   cached for statusCacheMs and concurrent checks of a device are merged.
// - output (button/switch), from what the agent declares: switch states come from hello, set acks and
//   out_state events, and are persisted in agent_outputs.
//
// After a wake (or a short press of a button bound to a device with an IP that is not known online) a
// check loop probes every probeIntervalMs until the device answers or wakeWindowMs elapses, and
// completes the action's log entry with the outcome.

import type {
  ActionResponse,
  AgentResult,
  DeviceAction,
  DeviceStatus,
  LogOutcome,
  OutputMode,
  OutputStatus,
  Reach,
} from "@awake/shared";
import { loadDevice, type DeviceRow } from "../access.ts";
import type { HelloOutput } from "../agents/protocol.ts";
import type { AgentHub, CommandResult, HubListener } from "../agents/hub.ts";
import type { Timing } from "../config.ts";
import { transaction, type Db } from "../db.ts";
import { ApiError } from "../errors.ts";
import type { EventBus } from "../events.ts";
import { log } from "../log.ts";

interface OutputRow {
  agent_id: string;
  output_id: string;
  mode: OutputMode;
  has_long: number;
  is_on: number | null;
  changed_at: number | null;
  present: number;
}

export interface Actor {
  id: string;
  username: string;
}

export class DeviceService implements HubListener {
  private reach = new Map<string, Reach>();
  private inflight = new Map<string, Promise<DeviceStatus>>();
  private loops = new Map<string, { timer: NodeJS.Timeout; logId: number }>();

  constructor(
    private db: Db,
    private hub: AgentHub,
    private bus: EventBus,
    private timing: Timing,
  ) {
    hub.setListener(this);
  }

  close(): void {
    for (const loop of this.loops.values()) clearTimeout(loop.timer);
    this.loops.clear();
  }

  // ---------- status ----------

  status(deviceId: string): DeviceStatus {
    const device = loadDevice(this.db, deviceId);
    if (!device) return { reach: { state: "unknown", reason: "not_checked", checkedAt: null }, output: null, ready: false };
    return this.statusOf(device);
  }

  statusOf(device: DeviceRow): DeviceStatus {
    const output = device.kind === "output" ? this.outputStatus(device) : null;
    const reach: Reach = !device.ip
      ? { state: "unknown", reason: "no_ip", checkedAt: null }
      : (this.reach.get(device.id) ?? { state: "unknown", reason: "not_checked", checkedAt: null });
    const ready = device.kind === "wol" ? this.wolAgents(device.id).some((a) => this.hub.isOnline(a.id)) : output?.available === true;
    return { reach, output, ready };
  }

  /** Actions the device supports given its kind and its output's capabilities. */
  actions(device: DeviceRow): DeviceAction[] {
    if (device.kind === "wol") return ["wake"];
    const row = this.outputRow(device);
    if (!row) return [];
    if (row.mode === "switch") return ["on", "off"];
    return row.has_long ? ["press", "long_press"] : ["press"];
  }

  /** Checks reachability through the agents, reusing a recent result and never interrupting a wake. */
  async check(deviceId: string): Promise<DeviceStatus> {
    const device = loadDevice(this.db, deviceId);
    if (!device) return this.status(deviceId);
    const current = this.statusOf(device);
    if (current.reach.state === "waking" || (current.reach.state === "unknown" && current.reach.reason === "no_ip")) return current;
    if (current.reach.checkedAt && Date.now() - current.reach.checkedAt < this.timing.statusCacheMs) return current;

    let running = this.inflight.get(deviceId);
    if (!running) {
      running = this.runCheck(deviceId).finally(() => this.inflight.delete(deviceId));
      this.inflight.set(deviceId, running);
    }
    return running;
  }

  /** Call when a device's address or action changes, or it is deleted: its state is no longer valid. */
  forget(deviceId: string): void {
    const loop = this.loops.get(deviceId);
    if (loop) {
      clearTimeout(loop.timer);
      this.loops.delete(deviceId);
      this.finishLog(loop.logId, "ok", null); // the outcome can no longer be verified
    }
    this.reach.delete(deviceId);
  }

  // ---------- actions ----------

  /**
   * Performs an action. Throws ApiError on failure; `results` (per-agent outcome) is attached to the
   * response and to ACTION_FAILED errors only when `withResults` (house owners and editors).
   */
  async act(device: DeviceRow, action: DeviceAction, actor: Actor, withResults: boolean): Promise<ActionResponse> {
    if (!this.actions(device).includes(action)) throw new ApiError(400, "ACTION_NOT_SUPPORTED");
    if ((action === "wake" || action === "press") && this.loops.has(device.id)) throw new ApiError(409, "ALREADY_WAKING");

    const results = action === "wake" ? await this.sendWake(device) : [await this.sendToOutput(device, action)];
    const ok = results.some((r) => r.status === "ok");
    const verify = ok && !!device.ip && (action === "wake" || (action === "press" && this.reach.get(device.id)?.state !== "online"));
    const outcome: LogOutcome = !ok ? "failed" : verify ? "waking" : "ok";
    const logId = this.logAction(device, { actor, source: "user", action, outcome, results });

    if (!ok) throw new ApiError(502, "ACTION_FAILED", undefined, withResults ? results : undefined);
    if (verify) this.startLoop(device.id, logId);
    this.emitDevice(device.id);
    return { status: this.status(device.id), ...(withResults ? { results } : {}) };
  }

  private async sendWake(device: DeviceRow): Promise<AgentResult[]> {
    const agents = this.wolAgents(device.id);
    if (agents.length === 0) throw new ApiError(409, "NO_AGENTS_ASSIGNED");
    if (!agents.some((a) => this.hub.isOnline(a.id))) throw new ApiError(409, "NO_AGENTS_ONLINE");
    return Promise.all(agents.map(async (a) => toResult(a, await this.hub.wake(a.id, device.mac!))));
  }

  private async sendToOutput(device: DeviceRow, action: DeviceAction): Promise<AgentResult> {
    const row = this.outputRow(device);
    if (!row?.present) throw new ApiError(409, "OUTPUT_UNAVAILABLE");
    if (!this.hub.isOnline(row.agent_id)) throw new ApiError(409, "AGENT_OFFLINE");
    const agent = this.db.prepare("SELECT id, name FROM agents WHERE id = ?").get(row.agent_id) as { id: string; name: string };

    if (action === "press" || action === "long_press") {
      return toResult(agent, await this.hub.press(row.agent_id, row.output_id, action === "long_press"));
    }
    const res = await this.hub.set(row.agent_id, row.output_id, action === "on");
    // Even a failed set may report the actual state.
    if (res.on !== undefined) this.storeSwitch(row.agent_id, row.output_id, res.on);
    return toResult(agent, res);
  }

  // ---------- agent events (HubListener) ----------

  agentConnected(agentId: string, outputs: HelloOutput[]): void {
    const now = Date.now();
    const changes: { outputId: string; on: boolean }[] = [];
    transaction(this.db, () => {
      const previous = new Map(
        (this.db.prepare("SELECT * FROM agent_outputs WHERE agent_id = ?").all(agentId) as unknown as OutputRow[]).map((r) => [r.output_id, r]),
      );
      this.db.prepare("UPDATE agent_outputs SET present = 0 WHERE agent_id = ?").run(agentId);
      const upsert = this.db.prepare(
        `INSERT INTO agent_outputs (agent_id, output_id, mode, has_long, is_on, changed_at, present) VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (agent_id, output_id) DO UPDATE SET
           mode = excluded.mode, has_long = excluded.has_long, is_on = excluded.is_on, changed_at = excluded.changed_at, present = 1`,
      );
      for (const o of outputs) {
        const prev = previous.get(o.id);
        const on = o.mode === "switch" ? o.on : null;
        const changed = on !== null && prev?.mode === "switch" && prev.is_on !== null && Boolean(prev.is_on) !== on;
        // A switch that changed while the agent was offline: changed_at is when we learnt it.
        const changedAt = on === null ? null : changed || !prev || prev.mode !== "switch" ? now : prev.changed_at;
        upsert.run(agentId, o.id, o.mode, o.mode === "button" && o.long ? 1 : 0, on === null ? null : Number(on), changedAt);
        if (changed) changes.push({ outputId: o.id, on: on! });
      }
    });
    for (const c of changes) this.logSwitchFromAgent(agentId, c.outputId, c.on);
    this.emitAgent(agentId, true);
  }

  agentDisconnected(agentId: string): void {
    this.emitAgent(agentId, false);
  }

  /** Only the agents list shows info: no device changes (at most one every few minutes per agent). */
  agentInfoChanged(agentId: string): void {
    const agent = this.db.prepare("SELECT house_id FROM agents WHERE id = ?").get(agentId) as { house_id: string } | undefined;
    if (agent) this.bus.toHouse(agent.house_id, { type: "agent", id: agentId, houseId: agent.house_id, online: this.hub.isOnline(agentId) });
  }

  outputChanged(agentId: string, outputId: string, on: boolean): void {
    const row = this.db.prepare("SELECT * FROM agent_outputs WHERE agent_id = ? AND output_id = ?").get(agentId, outputId) as
      | OutputRow
      | undefined;
    if (!row?.present || row.mode !== "switch") {
      log.debug("agent", "out_state for an unknown output or not a switch, ignored", { agent: agentId, out: outputId });
      return;
    }
    if (row.is_on !== null && Boolean(row.is_on) === on) return;
    this.storeSwitch(agentId, outputId, on);
    this.logSwitchFromAgent(agentId, outputId, on);
    const device = this.deviceOfOutput(agentId, outputId);
    if (device) this.emitDevice(device.id);
  }

  // ---------- internals ----------

  private storeSwitch(agentId: string, outputId: string, on: boolean): void {
    this.db
      .prepare(
        `UPDATE agent_outputs SET is_on = ?, changed_at = ?
         WHERE agent_id = ? AND output_id = ? AND (is_on IS NULL OR is_on != ?)`,
      )
      .run(Number(on), Date.now(), agentId, outputId, Number(on));
  }

  private logSwitchFromAgent(agentId: string, outputId: string, on: boolean): void {
    const device = this.deviceOfOutput(agentId, outputId);
    if (device) this.logAction(device, { actor: null, source: "agent", action: on ? "on" : "off", outcome: "ok", results: null });
  }

  private outputStatus(device: DeviceRow): OutputStatus | null {
    const row = this.outputRow(device);
    if (!row) return null;
    return {
      mode: row.mode,
      long: row.mode === "button" && !!row.has_long,
      on: row.mode === "switch" && row.is_on !== null ? Boolean(row.is_on) : null,
      available: !!row.present && this.hub.isOnline(row.agent_id),
    };
  }

  private outputRow(device: DeviceRow): OutputRow | undefined {
    if (device.kind !== "output" || !device.agent_id || !device.output_id) return undefined;
    return this.db.prepare("SELECT * FROM agent_outputs WHERE agent_id = ? AND output_id = ?").get(device.agent_id, device.output_id) as
      | OutputRow
      | undefined;
  }

  private deviceOfOutput(agentId: string, outputId: string): DeviceRow | undefined {
    return this.db.prepare("SELECT * FROM devices WHERE agent_id = ? AND output_id = ?").get(agentId, outputId) as DeviceRow | undefined;
  }

  private wolAgents(deviceId: string): { id: string; name: string }[] {
    return this.db
      .prepare("SELECT a.id, a.name FROM device_agents da JOIN agents a ON a.id = da.agent_id WHERE da.device_id = ? ORDER BY a.name")
      .all(deviceId) as { id: string; name: string }[];
  }

  /** Agents that can probe the device: its WoL agents, or the agent owning its output. */
  private probeAgents(device: DeviceRow): string[] {
    if (device.kind === "wol") return this.wolAgents(device.id).map((a) => a.id);
    return device.agent_id ? [device.agent_id] : [];
  }

  private async runCheck(deviceId: string): Promise<DeviceStatus> {
    const device = loadDevice(this.db, deviceId);
    if (!device?.ip) return this.status(deviceId);

    const result = await this.probeAll(device);
    // A wake may have started while we were probing: it owns the status now.
    if (this.loops.has(deviceId)) return this.status(deviceId);

    const before = this.reach.get(deviceId)?.state;
    const reach: Reach =
      result === "no_agents"
        ? { state: "unknown", reason: "no_agents", checkedAt: Date.now() }
        : { state: result === "up" ? "online" : "offline", checkedAt: Date.now() };
    this.reach.set(deviceId, reach);
    if (before !== reach.state) this.emitDevice(deviceId);
    return this.status(deviceId);
  }

  /** Probes through every online agent able to; the device is up if any of them sees it. */
  private async probeAll(device: DeviceRow): Promise<"up" | "down" | "no_agents"> {
    const online = this.probeAgents(device).filter((id) => this.hub.isOnline(id));
    if (online.length === 0) return "no_agents";
    const results = await Promise.all(online.map((id) => this.hub.probe(id, device.ip!, device.probe_port)));
    return results.includes("up") ? "up" : "down";
  }

  private startLoop(deviceId: string, logId: number): void {
    const startedAt = Date.now();
    const wake = { startedAt, deadline: startedAt + this.timing.wakeWindowMs, attempts: 0 };
    this.reach.set(deviceId, { state: "waking", checkedAt: this.reach.get(deviceId)?.checkedAt ?? null, wake });

    const tick = async () => {
      const device = loadDevice(this.db, deviceId);
      if (!device?.ip || !this.loops.has(deviceId)) return;

      const result = await this.probeAll(device);
      if (!this.loops.has(deviceId)) return; // forgotten meanwhile
      wake.attempts++;

      if (result === "up") {
        this.loops.delete(deviceId);
        this.reach.set(deviceId, { state: "online", checkedAt: Date.now() });
        this.finishLog(logId, "online", Date.now() - startedAt);
        this.emitDevice(deviceId);
      } else if (Date.now() + this.timing.probeIntervalMs > wake.deadline) {
        this.loops.delete(deviceId);
        this.reach.set(deviceId, { state: "offline", checkedAt: Date.now() });
        this.finishLog(logId, "timeout", null);
        this.emitDevice(deviceId);
      } else {
        this.loops.get(deviceId)!.timer = setTimeout(tick, this.timing.probeIntervalMs);
      }
    };

    this.loops.set(deviceId, { timer: setTimeout(tick, this.timing.probeIntervalMs), logId });
  }

  private logAction(
    device: DeviceRow,
    entry: { actor: Actor | null; source: "user" | "agent"; action: DeviceAction; outcome: LogOutcome; results: AgentResult[] | null },
  ): number {
    const house = this.db.prepare("SELECT name FROM houses WHERE id = ?").get(device.house_id) as { name: string };
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO action_log (device_id, device_name, house_id, house_name, actor_user_id, actor_username, source, action, outcome, results, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        device.id,
        device.name,
        device.house_id,
        house.name,
        entry.actor?.id ?? null,
        entry.actor?.username ?? null,
        entry.source,
        entry.action,
        entry.outcome,
        entry.results ? JSON.stringify(entry.results) : null,
        Date.now(),
      );
    return Number(lastInsertRowid);
  }

  private finishLog(logId: number, outcome: LogOutcome, onlineAfterMs: number | null): void {
    this.db.prepare("UPDATE action_log SET outcome = ?, online_after_ms = ? WHERE id = ?").run(outcome, onlineAfterMs, logId);
  }

  private emitDevice(deviceId: string): void {
    this.bus.toDevice(deviceId, { type: "device", id: deviceId, status: this.status(deviceId) });
  }

  private emitAgent(agentId: string, online: boolean): void {
    const agent = this.db.prepare("SELECT house_id FROM agents WHERE id = ?").get(agentId) as { house_id: string } | undefined;
    if (!agent) return;
    this.bus.toHouse(agent.house_id, { type: "agent", id: agentId, houseId: agent.house_id, online });
    const devices = this.db
      .prepare("SELECT id FROM devices WHERE agent_id = ? UNION SELECT device_id FROM device_agents WHERE agent_id = ?")
      .all(agentId, agentId) as { id: string }[];
    for (const d of devices) this.emitDevice(d.id);
  }
}

function toResult(agent: { id: string; name: string }, res: CommandResult): AgentResult {
  return { agentId: agent.id, agentName: agent.name, status: res.status, ...(res.err ? { err: res.err } : {}) };
}
