// Stable machine-readable error codes returned by the API as `{ error: <code> }`.
// The UI maps each code to its own translated text: the backend never sends user-facing messages.

import type { AgentResult } from "./api.ts";

export const ERROR_CODES = [
  // generic
  "VALIDATION",
  "NOT_FOUND",
  "FORBIDDEN",
  "RATE_LIMITED",
  "INTERNAL",
  // authentication
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_PENDING",
  "ACCOUNT_DISABLED",
  "PASSWORD_CHANGE_REQUIRED",
  "WRONG_PASSWORD",
  "INVALID_USERNAME",
  "INVALID_PASSWORD",
  "USERNAME_TAKEN",
  "REGISTRATION_DISABLED",
  "INVALID_TOKEN",
  "PROVIDER_NOT_FOUND",
  "OAUTH_FAILED",
  "OAUTH_NOT_LINKED",
  "IDENTITY_IN_USE",
  "LAST_LOGIN_METHOD",
  "SECRET_KEY_MISSING",
  "PROVIDER_ID_TAKEN",
  "PROVIDER_UNREACHABLE",
  // users, houses, sharing
  "LAST_ADMIN",
  "LAST_OWNER",
  "CANNOT_TARGET_SELF",
  "USER_NOT_FOUND",
  "ALREADY_MEMBER",
  "ALREADY_SHARED",
  "ALREADY_HAS_ACCESS",
  // devices and agents
  "INVALID_MAC",
  "INVALID_IP",
  "INVALID_PORT",
  "AGENT_NOT_IN_HOUSE",
  "OUTPUT_NOT_FOUND",
  "OUTPUT_IN_USE",
  "ACTION_NOT_SUPPORTED",
  "NO_AGENTS_ASSIGNED",
  "NO_AGENTS_ONLINE",
  "AGENT_OFFLINE",
  "OUTPUT_UNAVAILABLE",
  "ACTION_FAILED",
  "ALREADY_WAKING",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: ErrorCode;
  /** Path of the offending request field, for validation errors. */
  field?: string;
  /** Per-agent outcome, on ACTION_FAILED (only for house owners and editors). */
  results?: AgentResult[];
}
