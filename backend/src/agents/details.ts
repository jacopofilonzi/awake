// Diagnostics of an agent for the house owners and editors (Agent.details): the last info it reported,
// its connections (agent_sessions, written by the hub) and the commands sent to it (action_log).
//
// Commands are found through the per-agent results of the action log (a JSON array of AgentResult):
// the queries walk the house's log through its (house_id, created_at) index, since an agent never
// changes house, and look inside each entry's results with json_each.

import type { AgentDetails, AgentInfo } from "@awake/shared";
import type { Db } from "../db.ts";
import { log } from "../log.ts";
import type { AgentHub } from "./hub.ts";
import { parseInfo } from "./protocol.ts";

const DAY_MS = 86_400_000;

export interface AgentDetailsRow {
  id: string;
  house_id: string;
  info: string | null;
  info_at: number | null;
}

export function agentDetails(db: Db, hub: AgentHub, agent: AgentDetailsRow): AgentDetails {
  const since = Date.now() - DAY_MS;

  const latest = db.prepare("SELECT ip FROM agent_sessions WHERE agent_id = ? ORDER BY connected_at DESC, id DESC LIMIT 1").get(agent.id) as
    | { ip: string | null }
    | undefined;
  const { n: connections24h } = db
    .prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE agent_id = ? AND connected_at >= ?")
    .get(agent.id, since) as { n: number };
  const lastClose = db
    .prepare(
      `SELECT closed_at, close_code FROM agent_sessions WHERE agent_id = ? AND closed_at IS NOT NULL
       ORDER BY closed_at DESC, id DESC LIMIT 1`,
    )
    .get(agent.id) as { closed_at: number; close_code: number | null } | undefined;

  const commands = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(r.value ->> 'status' IS NOT 'ok'), 0) AS failed
       FROM action_log l, json_each(l.results) r
       WHERE l.house_id = ? AND l.created_at >= ? AND l.results IS NOT NULL AND r.value ->> 'agentId' = ?`,
    )
    .get(agent.house_id, since, agent.id) as { n: number; failed: number };
  const last = db
    .prepare(
      `SELECT l.created_at FROM action_log l, json_each(l.results) r
       WHERE l.house_id = ? AND l.results IS NOT NULL AND r.value ->> 'agentId' = ?
       ORDER BY l.created_at DESC LIMIT 1`,
    )
    .get(agent.house_id, agent.id) as { created_at: number } | undefined;

  return {
    info: storedInfo(agent),
    infoAt: agent.info_at,
    connection: {
      since: hub.connectedSince(agent.id),
      ip: latest?.ip ?? null,
      connections24h,
      // close_code is always written with closed_at; 1006 covers a row that would somehow lack it.
      lastClose: lastClose ? { at: lastClose.closed_at, code: lastClose.close_code ?? 1006 } : null,
    },
    stats: { commands24h: commands.n, failed24h: commands.failed, lastCommandAt: last?.created_at ?? null },
  };
}

/** The stored info, validated again: the column is ours, but a bad row must not break the API. */
function storedInfo(agent: AgentDetailsRow): AgentInfo | null {
  if (!agent.info) return null;
  try {
    return parseInfo(JSON.parse(agent.info));
  } catch (err) {
    log.warn("agent", "stored info is not valid JSON, ignored", { id: agent.id, err: (err as Error).message });
    return null;
  }
}
