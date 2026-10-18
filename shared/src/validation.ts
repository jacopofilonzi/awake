// Request validation shared by the backend (authoritative) and the web UI (early feedback).
// A zod issue whose message is an ErrorCode is reported as that code, anything else as VALIDATION.

import { z } from "zod";
import { DEVICE_ICONS, HOUSE_ICONS } from "./api.ts";
import type { ErrorCode } from "./errors.ts";

const code = (c: ErrorCode) => ({ message: c });

export const NAME_MAX_LENGTH = 64;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

/** Lowercase letters, digits, `.`, `_`, `-`; 3–32 chars, starting with a letter or digit. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, code("INVALID_USERNAME"));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, code("INVALID_PASSWORD"))
  .max(PASSWORD_MAX_LENGTH, code("INVALID_PASSWORD"));

export const nameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);

export const houseIconSchema = z.enum(HOUSE_ICONS);
export const houseInputSchema = z.object({ name: nameSchema, icon: houseIconSchema.default("house") });
/** PATCH /houses/:id: name and/or icon. */
export const housePatchSchema = z
  .object({ name: nameSchema.optional(), icon: houseIconSchema.optional() })
  .refine((h) => h.name !== undefined || h.icon !== undefined, code("VALIDATION"));

export const roleSchema = z.enum(["owner", "editor", "member"]);

/** Accepts `:`, `-`, `.` or no separator; normalizes to `AA:BB:CC:DD:EE:FF`. */
export const macSchema = z
  .string()
  .transform((s) => s.replace(/[\s:.-]/g, "").toUpperCase())
  .refine((s) => /^[0-9A-F]{12}$/.test(s), code("INVALID_MAC"))
  .transform((s) => s.match(/../g)!.join(":"));

export const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export const ipSchema = z.string().trim().regex(IPV4_RE, code("INVALID_IP"));

export const portSchema = z.number().int(code("INVALID_PORT")).min(1, code("INVALID_PORT")).max(65535, code("INVALID_PORT"));

/** Output ids as declared by agents (docs/PROTOCOL.md §3). */
export const OUTPUT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const deviceIconSchema = z.enum(DEVICE_ICONS);

export const deviceInputSchema = z.object({
  name: nameSchema,
  icon: deviceIconSchema.nullable().default(null),
  ip: ipSchema.nullable().default(null),
  probePort: portSchema.nullable().default(null),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("wol"), mac: macSchema, agentIds: z.array(z.string()).max(16).default([]) }),
    z.object({ type: z.literal("output"), agentId: z.string(), outputId: z.string().regex(OUTPUT_ID_RE) }),
  ]),
});

export const deviceActionSchema = z.enum(["wake", "press", "long_press", "on", "off"]);

/** Provider ids appear in URLs and in linked identities: lowercase letters, digits and `-`. */
export const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//.test(u));

export const providerInputSchema = z.object({
  id: z.string().trim().toLowerCase().regex(PROVIDER_ID_RE).optional(),
  label: nameSchema,
  type: z.enum(["oidc", "github"]),
  issuer: httpsUrl.nullable().default(null),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().max(1024).default(""),
  scopes: z.string().trim().min(1).max(256),
  enabled: z.boolean().default(true),
  allowSignup: z.boolean().default(false),
});

export const serverSettingsSchema = z.object({
  registrationEnabled: z.boolean(),
  autoApprove: z.boolean(),
});
