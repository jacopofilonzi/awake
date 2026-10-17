import type { Context, MiddlewareHandler } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "@awake/shared";
import type { AgentHub } from "../agents/hub.ts";
import type { OAuthProviders } from "../auth/oauth.ts";
import { readSession, type SessionInfo } from "../auth/sessions.ts";
import { clientIp } from "../clientip.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { DeviceService } from "../devices/service.ts";
import { ApiError } from "../errors.ts";
import type { EventBus } from "../events.ts";
import type { Limiters } from "../ratelimit.ts";

export interface Services {
  config: Config;
  db: Db;
  hub: AgentHub;
  devices: DeviceService;
  bus: EventBus;
  limiters: Limiters;
  oauth: OAuthProviders;
}

export type Env = { Bindings: HttpBindings; Variables: { auth: SessionInfo } };
export type Ctx = Context<Env>;

export function requestIp(c: Ctx, config: Pick<Config, "trustProxy" | "clientIpHeader">): string {
  return clientIp(c.env.incoming.headers, c.env.incoming.socket.remoteAddress, config);
}

/**
 * Parses the JSON body. A zod issue whose message is an ErrorCode is returned as that code,
 * anything else as VALIDATION; `field` is the path of the offending property.
 */
export async function readBody<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const code = ERROR_CODES.includes(issue?.message as ErrorCode) ? (issue!.message as ErrorCode) : "VALIDATION";
  const field = issue?.path.length ? issue.path.join(".") : undefined;
  throw new ApiError(400, code, field);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence in depth (cookies are already SameSite=Lax): state-changing requests must come from
 * our own origin and carry JSON, which a cross-site form cannot send without a CORS preflight.
 */
export function sameOrigin(config: Config): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && origin !== config.publicUrl) throw new ApiError(403, "FORBIDDEN");
      if (c.req.header("sec-fetch-site") === "cross-site") throw new ApiError(403, "FORBIDDEN");
      const hasBody = Number(c.req.header("content-length") ?? 0) > 0 || c.req.header("transfer-encoding") !== undefined;
      if (hasBody && !c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new ApiError(400, "VALIDATION");
      }
    }
    await next();
  };
}

/** Paths usable while the user still has to change the password set by an admin. */
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(["/api/auth/me", "/api/auth/password", "/api/auth/logout"]);

/** Requires a valid session of an active user; sets `c.var.auth`. */
export function requireUser(s: Services): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = readSession(s.db, s.config, c);
    if (!session || session.user.status !== "active") throw new ApiError(401, "UNAUTHORIZED");
    if (session.user.must_change_password && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(c.req.path)) {
      throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED");
    }
    c.set("auth", session);
    await next();
  };
}

export function requireAdmin(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!c.var.auth.user.is_admin) throw new ApiError(403, "FORBIDDEN");
    await next();
  };
}
