// WebSocket gateway for agents: authentication, presence, commands and their replies.
// Protocol: docs/PROTOCOL.md. The hub only speaks the protocol; what an event means for devices
// (state, logs, live updates) is decided by the HubListener (the device service).
//
// Diagnostics: every authenticated connection is a row in agent_sessions (ip, start, end, close code;
// kept for 7 days), and the last `info` an agent reported is kept in agents.info. The close code
// recorded is the one the server used when it closed the connection itself (replaced, revoked,
// shutdown...), otherwise the one the agent sent (1006 when the connection dropped without a close
// frame, which includes the server dropping a silent connection).

import crypto from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION } from "@awake/shared";
import type { Timing } from "../config.ts";
import type { Db } from "../db.ts";
import type { AgentInfo } from "@awake/shared";
import { log } from "../log.ts";
import type { RateLimiter } from "../ratelimit.ts";
import { hashToken } from "../secrets.ts";
import {
  CloseCode,
  MAX_MESSAGE_BYTES,
  parseMessage,
  parseInfo,
  parseOutputs,
  type AgentToServer,
  type HelloOutput,
  type ServerToAgent,
} from "./protocol.ts";

export interface HubListener {
  /** After a successful hello, with the outputs it declared. */
  agentConnected(agentId: string, outputs: HelloOutput[]): void;
  agentDisconnected(agentId: string): void;
  /** A switch changed on the agent's side (out_state). */
  outputChanged(agentId: string, outputId: string, on: boolean): void;
  /** The agent sent a new `info` (not called for the one in hello: agentConnected follows it). */
  agentInfoChanged(agentId: string): void;
}

/** Closed connections older than this are pruned from agent_sessions. */
const SESSION_RETENTION_MS = 7 * 86_400_000;

/** Outcome of a command sent to one agent. */
export interface CommandResult {
  status: "ok" | "offline" | "timeout" | "error";
  err?: string;
  /** For `set`: the switch state reported in the ack. */
  on?: boolean;
}

export type ProbeOutcome = "up" | "down" | "error";

type Reply = Extract<AgentToServer, { t: "ack" } | { t: "probe_result" }>;

interface AgentConn {
  ws: WebSocket;
  agentId: string;
  name: string;
  lastActivity: number;
  /** Row in agent_sessions, and when the connection was authenticated. */
  sessionId: number;
  connectedAt: number;
  /** Last accepted info (hello always counts), for the minimum interval between info messages. */
  lastInfoAt: number;
  /** Close code the server used when it closed this connection itself. */
  closeCode: number | null;
  pending: Map<string, { expects: Reply["t"]; resolve: (msg: Reply | null) => void }>;
}

export class AgentHub {
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private conns = new Map<string, AgentConn>();
  private idleTimer: NodeJS.Timeout;
  private closed = false;
  private listener: HubListener | null = null;

  constructor(
    private db: Db,
    private timing: Timing,
    private limiter: RateLimiter,
  ) {
    // Connections still open in the database were cut by a stop of the server that skipped close()
    // (crash, kill): they ended, at the latest, when the agent was last seen.
    const stale = db
      .prepare(
        `UPDATE agent_sessions SET close_code = ?,
           closed_at = MAX(connected_at, COALESCE((SELECT last_seen FROM agents a WHERE a.id = agent_sessions.agent_id), ?))
         WHERE closed_at IS NULL`,
      )
      .run(CloseCode.ServerShutdown, Date.now());
    if (stale.changes) log.info("agent", "closed connections left open by the last stop", { count: Number(stale.changes) });

    // Drop silent connections (Wi-Fi lost without a FIN, etc.).
    this.idleTimer = setInterval(
      () => {
        const now = Date.now();
        for (const conn of this.conns.values()) {
          if (now - conn.lastActivity > timing.agentIdleMs) conn.ws.terminate();
        }
      },
      Math.min(10_000, timing.agentIdleMs / 2),
    );
    this.idleTimer.unref();
  }

  setListener(listener: HubListener): void {
    this.listener = listener;
  }

  isOnline(agentId: string): boolean {
    return this.conns.has(agentId);
  }

  /** Start of the agent's current connection; null while offline. */
  connectedSince(agentId: string): number | null {
    return this.conns.get(agentId)?.connectedAt ?? null;
  }

  /** Closes the agent's connection (token regenerated, agent or house deleted). */
  disconnect(agentId: string): void {
    const conn = this.conns.get(agentId);
    if (conn) closeConn(conn, CloseCode.Revoked, "revoked");
  }

  close(): void {
    // Sessions are ended here, while the database is still open: close handlers run after it closes.
    for (const conn of this.conns.values()) this.endSession(conn, CloseCode.ServerShutdown);
    this.closed = true;
    clearInterval(this.idleTimer);
    for (const ws of this.wss.clients) ws.close(CloseCode.ServerShutdown, "server shutdown");
  }

  async wake(agentId: string, mac: string): Promise<CommandResult> {
    return ackResult(await this.request(agentId, "ack", this.timing.ackTimeoutMs, (id) => ({ t: "wake", id, mac })));
  }

  async press(agentId: string, out: string, long: boolean): Promise<CommandResult> {
    return ackResult(
      await this.request(agentId, "ack", this.timing.ackTimeoutMs, (id) => ({ t: "press", id, out, ...(long ? { long: true } : {}) })),
    );
  }

  async set(agentId: string, out: string, on: boolean): Promise<CommandResult> {
    return ackResult(await this.request(agentId, "ack", this.timing.ackTimeoutMs, (id) => ({ t: "set", id, out, on })));
  }

  /** Asks an agent whether a host is up (ICMP, or TCP connect when port is set). */
  async probe(agentId: string, ip: string, port: number | null): Promise<ProbeOutcome> {
    const reply = await this.request(agentId, "probe_result", this.timing.probeResultTimeoutMs, (id) => ({
      t: "probe",
      id,
      ip,
      ...(port ? { port } : {}),
      timeout: this.timing.probeTimeoutMs,
    }));
    if (typeof reply === "object" && reply?.t === "probe_result") return reply.err ? "error" : reply.up === true ? "up" : "down";
    return "error";
  }

  handleConnection(ws: WebSocket, ip: string): void {
    if (this.limiter.isBlocked(ip)) {
      ws.close(CloseCode.RateLimited, "too many attempts");
      return;
    }

    let conn: AgentConn | null = null;
    const helloTimer = setTimeout(() => ws.close(CloseCode.HelloTimeout, "hello timeout"), this.timing.helloTimeoutMs);

    ws.on("message", (data, isBinary) => {
      if (this.closed) return; // shutting down: the database may already be closed
      const msg = isBinary ? null : parseMessage(data.toString());
      if (!msg) {
        if (conn) closeConn(conn, CloseCode.ProtocolError, "invalid message");
        else ws.close(CloseCode.ProtocolError, "invalid message");
        return;
      }

      if (!conn) {
        conn = this.authenticate(ws, ip, msg);
        if (conn) clearTimeout(helloTimer);
        return;
      }

      conn.lastActivity = Date.now();
      switch (msg.t) {
        case "hb":
          this.db.prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(conn.lastActivity, conn.agentId);
          send(ws, { t: "hb" });
          break;
        case "ack":
        case "probe_result": {
          if (typeof msg.id !== "string") break;
          const pending = conn.pending.get(msg.id);
          if (pending?.expects === msg.t) {
            conn.pending.delete(msg.id);
            pending.resolve(msg);
          }
          break;
        }
        case "info":
          this.receiveInfo(conn, msg);
          break;
        case "out_state":
          if (typeof msg.out === "string" && typeof msg.on === "boolean") {
            this.listener?.outputChanged(conn.agentId, msg.out, msg.on);
          }
          break;
        // Unknown message types are ignored for forward compatibility.
      }
    });

    ws.on("close", (code) => {
      clearTimeout(helloTimer);
      if (!conn) return;
      for (const pending of conn.pending.values()) pending.resolve(null);
      conn.pending.clear();
      // Shutting down: the database may already be closed (close() ended the sessions).
      if (!this.closed) this.endSession(conn, conn.closeCode ?? code);
      if (this.conns.get(conn.agentId) !== conn) return; // replaced by a newer connection
      this.conns.delete(conn.agentId);
      if (this.closed) return;
      this.db.prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(Date.now(), conn.agentId);
      log.info("agent", "disconnected", { name: conn.name, id: conn.agentId });
      this.listener?.agentDisconnected(conn.agentId);
    });

    ws.on("error", () => ws.terminate());
  }

  private authenticate(ws: WebSocket, ip: string, msg: AgentToServer): AgentConn | null {
    if (msg.t !== "hello" || typeof msg.token !== "string") {
      ws.close(CloseCode.ProtocolError, "expected hello");
      return null;
    }
    if (msg.v !== PROTOCOL_VERSION) {
      ws.close(CloseCode.UnsupportedVersion, `supported version: ${PROTOCOL_VERSION}`);
      return null;
    }
    const outputs = parseOutputs(msg.outputs);
    if (!outputs) {
      ws.close(CloseCode.ProtocolError, "invalid outputs");
      return null;
    }
    const row = this.db.prepare("SELECT id, name FROM agents WHERE token_hash = ?").get(hashToken(msg.token)) as
      | { id: string; name: string }
      | undefined;
    if (!row) {
      this.limiter.recordFailure(ip);
      ws.close(CloseCode.AuthFailed, "invalid token");
      return null;
    }

    // One connection per agent: the newest one wins. Its close handler sees it was replaced and
    // does not report a disconnection.
    const now = Date.now();
    const previous = this.conns.get(row.id);
    const { lastInsertRowid } = this.db.prepare("INSERT INTO agent_sessions (agent_id, ip, connected_at) VALUES (?, ?, ?)").run(row.id, ip, now);
    this.db
      .prepare("DELETE FROM agent_sessions WHERE agent_id = ? AND closed_at IS NOT NULL AND closed_at < ?")
      .run(row.id, now - SESSION_RETENTION_MS);
    const conn: AgentConn = {
      ws,
      agentId: row.id,
      name: row.name,
      lastActivity: now,
      sessionId: Number(lastInsertRowid),
      connectedAt: now,
      lastInfoAt: now,
      closeCode: null,
      pending: new Map(),
    };
    this.conns.set(row.id, conn);
    if (previous) closeConn(previous, CloseCode.Replaced, "replaced by a new connection");

    const fw = typeof msg.fw === "string" ? msg.fw.slice(0, 64) : null;
    this.db.prepare("UPDATE agents SET firmware = ?, last_seen = ? WHERE id = ?").run(fw, now, row.id);
    // A hello without info (older firmware) leaves the last known info in place.
    const info = parseInfo(msg.info);
    if (info) this.storeInfo(row.id, info, now);
    send(ws, { t: "welcome", v: PROTOCOL_VERSION, name: row.name, hb: this.timing.heartbeatSec });
    log.info("agent", "connected", { name: row.name, id: row.id, ip, fw: fw ?? undefined, outputs: outputs.length });
    this.listener?.agentConnected(row.id, outputs);
    return conn;
  }

  /** An `info` message: rate-limited per connection, invalid fields dropped, never fatal. */
  private receiveInfo(conn: AgentConn, msg: AgentToServer): void {
    const now = conn.lastActivity;
    if (now - conn.lastInfoAt < this.timing.infoMinIntervalMs) {
      log.debug("agent", "info too soon after the previous one, ignored", { id: conn.agentId });
      return;
    }
    const info = parseInfo(msg);
    if (!info) {
      log.debug("agent", "info without valid fields, ignored", { id: conn.agentId });
      return;
    }
    conn.lastInfoAt = now;
    this.storeInfo(conn.agentId, info, now);
    this.listener?.agentInfoChanged(conn.agentId);
  }

  private storeInfo(agentId: string, info: AgentInfo, at: number): void {
    this.db.prepare("UPDATE agents SET info = ?, info_at = ? WHERE id = ?").run(JSON.stringify(info), at, agentId);
  }

  private endSession(conn: AgentConn, code: number): void {
    this.db
      .prepare("UPDATE agent_sessions SET closed_at = ?, close_code = ? WHERE id = ? AND closed_at IS NULL")
      .run(Date.now(), code, conn.sessionId);
  }

  private request(
    agentId: string,
    expects: Reply["t"],
    timeoutMs: number,
    build: (id: string) => ServerToAgent,
  ): Promise<Reply | null | "offline" | "timeout"> {
    const conn = this.conns.get(agentId);
    if (!conn) return Promise.resolve("offline");

    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        resolve("timeout");
      }, timeoutMs);
      conn.pending.set(id, {
        expects,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
      send(conn.ws, build(id));
    });
  }
}

function ackResult(reply: Reply | null | "offline" | "timeout"): CommandResult {
  if (reply === "offline" || reply === "timeout") return { status: reply };
  // null: the connection dropped while waiting.
  if (reply?.t !== "ack") return { status: "error", err: "disconnected" };
  const on = typeof reply.on === "boolean" ? reply.on : undefined;
  if (reply.ok === true) return { status: "ok", on };
  const err = typeof reply.err === "string" ? reply.err.slice(0, 64) : undefined;
  return { status: "error", err, on };
}

/** Closes a connection from the server side, remembering the code for its session row. */
function closeConn(conn: AgentConn, code: number, reason: string): void {
  conn.closeCode ??= code;
  conn.ws.close(code, reason);
}

function send(ws: WebSocket, msg: ServerToAgent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
