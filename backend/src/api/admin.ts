// /api/admin: user management, admins only. Admins manage accounts, not data: they do not see other
// users' houses or devices.

import { Hono } from "hono";
import { z } from "zod";
import { passwordSchema, usernameSchema, type AdminUserCreated } from "@awake/shared";
import { revokeSessions } from "../auth/sessions.ts";
import { countActiveAdmins, createUser, issuePasswordLink, loadUser, toAdminUser, type UserRow } from "../auth/users.ts";
import { isUniqueViolation, transaction } from "../db.ts";
import { ApiError } from "../errors.ts";
import { log } from "../log.ts";
import { hashPassword } from "../secrets.ts";
import { readBody, requireAdmin, requireUser, type Env, type Services } from "./common.ts";

export function adminRoutes(s: Services) {
  const { db, config, hub, bus } = s;
  const app = new Hono<Env>();
  app.use(requireUser(s), requireAdmin());

  const target = (id: string): UserRow => {
    const user = loadUser(db, id);
    if (!user) throw new ApiError(404, "NOT_FOUND");
    return user;
  };

  /** Removing admin rights from, or deactivating, the last active admin would lock everyone out. */
  const keepsAnAdmin = (user: UserRow) => {
    if (user.is_admin && user.status === "active" && countActiveAdmins(db) <= 1) throw new ApiError(409, "LAST_ADMIN");
  };

  app.get("/users", (c) => {
    const rows = db.prepare("SELECT * FROM users ORDER BY status = 'pending' DESC, username").all() as unknown as UserRow[];
    return c.json(rows.map((r) => toAdminUser(db, r)));
  });

  /** Creates a user with a password chosen by the admin (to change at first login) or a set-password link. */
  app.post("/users", async (c) => {
    const body = await readBody(
      c,
      z.object({
        username: usernameSchema,
        admin: z.boolean().default(false),
        credentials: z.discriminatedUnion("type", [
          z.object({ type: z.literal("password"), password: passwordSchema }),
          z.object({ type: z.literal("link") }),
        ]),
      }),
    );
    const passwordHash = body.credentials.type === "password" ? await hashPassword(body.credentials.password) : null;
    const user = createUser(db, {
      username: body.username,
      passwordHash,
      admin: body.admin,
      status: "active",
      mustChangePassword: passwordHash !== null,
    });
    const link = body.credentials.type === "link" ? issuePasswordLink(db, config, user.id, c.var.auth.user.id) : undefined;
    log.info("admin", "user created", { by: c.var.auth.user.username, user: user.username, admin: body.admin });
    return c.json({ user: toAdminUser(db, user), ...(link ? { link } : {}) } satisfies AdminUserCreated, 201);
  });

  /** Rename, grant/revoke admin, approve (pending → active), disable or re-enable. */
  app.patch("/users/:id", async (c) => {
    const user = target(c.req.param("id"));
    const self = user.id === c.var.auth.user.id;
    const body = await readBody(
      c,
      z.object({ username: usernameSchema.optional(), admin: z.boolean().optional(), status: z.enum(["active", "disabled"]).optional() }),
    );
    const demoting = body.admin === false && !!user.is_admin;
    const disabling = body.status === "disabled" && user.status !== "disabled";
    if ((demoting || disabling) && self) throw new ApiError(400, "CANNOT_TARGET_SELF");
    if (demoting || disabling) keepsAnAdmin(user);

    try {
      db.prepare(
        `UPDATE users SET username = COALESCE(?, username), is_admin = COALESCE(?, is_admin), status = COALESCE(?, status) WHERE id = ?`,
      ).run(body.username ?? null, body.admin === undefined ? null : Number(body.admin), body.status ?? null, user.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, "USERNAME_TAKEN", "username");
      throw err;
    }
    if (disabling) {
      revokeSessions(db, user.id);
      bus.closeUser(user.id);
    }
    log.info("admin", "user updated", { by: c.var.auth.user.username, user: user.username, ...body });
    return c.json(toAdminUser(db, loadUser(db, user.id)!));
  });

  /** A new set-password link (invite again, or reset a forgotten password). */
  app.post("/users/:id/password-link", (c) => {
    const user = target(c.req.param("id"));
    const link = issuePasswordLink(db, config, user.id, c.var.auth.user.id);
    log.info("admin", "password link issued", { by: c.var.auth.user.username, user: user.username });
    return c.json(link);
  });

  /**
   * Deletes the user. Houses where they are the only owner are deleted with everything in them
   * (agents disconnected); houses with other owners are kept.
   */
  app.delete("/users/:id", (c) => {
    const user = target(c.req.param("id"));
    if (user.id === c.var.auth.user.id) throw new ApiError(400, "CANNOT_TARGET_SELF");
    keepsAnAdmin(user);

    const orphaned = db
      .prepare(
        `SELECT house_id FROM house_members hm WHERE user_id = ? AND role = 'owner'
         AND NOT EXISTS (SELECT 1 FROM house_members o WHERE o.house_id = hm.house_id AND o.role = 'owner' AND o.user_id != ?)`,
      )
      .all(user.id, user.id) as { house_id: string }[];
    const agents = orphaned.flatMap(
      (h) => db.prepare("SELECT id FROM agents WHERE house_id = ?").all(h.house_id) as { id: string }[],
    );
    const audience = new Set(orphaned.flatMap((h) => bus.houseAudience(h.house_id)));

    transaction(db, () => {
      for (const h of orphaned) db.prepare("DELETE FROM houses WHERE id = ?").run(h.house_id);
      db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    });
    for (const a of agents) hub.disconnect(a.id);
    bus.closeUser(user.id);
    audience.delete(user.id);
    bus.toUsers(audience, { type: "houses" });
    bus.toUsers(audience, { type: "devices" });
    log.info("admin", "user deleted", { by: c.var.auth.user.username, user: user.username, housesDeleted: orphaned.length });
    return c.body(null, 204);
  });

  return app;
}
