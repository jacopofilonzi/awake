// HTTP API contract shared by the backend and the web UI. Reference: backend/API.md

/** Epoch milliseconds. */
export type Millis = number;

// ---------- config & auth ----------

export interface PublicConfig {
  version: string;
  protocolVersion: number;
  /** `enabled`: sign-up with username and password. `autoApprove`: new accounts are active right away. */
  registration: { enabled: boolean; autoApprove: boolean };
  /** External login providers enabled on this server (configured by admins). */
  providers: { id: string; label: string }[];
}

export interface User {
  id: string;
  username: string;
  email: string | null;
  admin: boolean;
  /** The user must set a new password before using anything else. */
  mustChangePassword: boolean;
  /** False for accounts created through an external provider that never set a password. */
  hasPassword: boolean;
}

export interface Identity {
  provider: string;
  providerLabel: string;
  email: string | null;
  createdAt: Millis;
}

export interface Me {
  user: User;
  identities: Identity[];
}

export interface RegisterResponse {
  /** "active": logged in (a session cookie was set). "pending": an admin must approve the account. */
  status: "active" | "pending";
  me?: Me;
}

export interface PasswordTokenInfo {
  username: string;
  expiresAt: Millis;
}

// ---------- admin ----------

export type UserStatus = "active" | "pending" | "disabled";

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  admin: boolean;
  status: UserStatus;
  mustChangePassword: boolean;
  hasPassword: boolean;
  /** Ids of the linked external providers. */
  providers: string[];
  /**
   * False when the account has no password and no linked provider that is still enabled (e.g. its
   * provider was deleted): an admin has to send a set-password link.
   */
  canLogIn: boolean;
  createdAt: Millis;
  lastLoginAt: Millis | null;
}

/** A one-time link that lets a user set their password. Shown only once. */
export interface PasswordLink {
  url: string;
  expiresAt: Millis;
}

export interface AdminUserCreated {
  user: AdminUser;
  link?: PasswordLink;
}

/** Server-wide settings editable by admins. */
export interface ServerSettings {
  /** Anyone can sign up with username and password. */
  registrationEnabled: boolean;
  /** New accounts (password sign-up or a provider allowing new accounts) are active without approval. */
  autoApprove: boolean;
  /** SECRET_KEY is set: login providers can be saved (their client secrets are encrypted with it). */
  secretKeyConfigured: boolean;
}

/** `oidc`: any OpenID Connect provider (Google, Microsoft, Authentik, Keycloak…). `github`: GitHub (OAuth 2). */
export type ProviderType = "oidc" | "github";

/** A login provider as admins see it. The client secret is never returned. */
export interface AdminProvider {
  /** Stable id used in the redirect URI and in linked identities; cannot change. */
  id: string;
  label: string;
  type: ProviderType;
  /** OIDC: the issuer URL. GitHub: the base URL of GitHub Enterprise, null for github.com. */
  issuer: string | null;
  clientId: string;
  scopes: string;
  enabled: boolean;
  /** Someone logging in with an identity not linked to any account gets a new account. */
  allowSignup: boolean;
  /** Register this at the provider. */
  redirectUri: string;
  /** Accounts linked to this provider. */
  linkedUsers: number;
  createdAt: Millis;
}

export interface ProviderInput {
  /** Only on creation. */
  id?: string;
  label: string;
  type: ProviderType;
  issuer: string | null;
  clientId: string;
  /** Required on creation; on update an empty value keeps the current secret. */
  clientSecret: string;
  scopes: string;
  enabled: boolean;
  allowSignup: boolean;
}

export interface ProviderDeleted {
  /** Users left without any way to log in (no password, no other provider): they need a password link. */
  withoutLogin: string[];
}

// ---------- houses ----------

/** owner: everything, members included. editor: agents and devices. member: sees and uses devices. */
export type Role = "owner" | "editor" | "member";

/** Icons a house can have, to tell houses apart at a glance (Lucide names; the UI maps them). */
export const HOUSE_ICONS = ["house", "building-2", "building", "house-heart", "waves", "mountain", "trees", "store", "warehouse", "wrench", "server", "school"] as const;
export type HouseIcon = (typeof HOUSE_ICONS)[number];

export interface House {
  id: string;
  name: string;
  icon: HouseIcon;
  role: Role;
  createdAt: Millis;
}

export interface HouseMember {
  userId: string;
  username: string;
  role: Role;
  createdAt: Millis;
}

// ---------- agents ----------

export type OutputMode = "button" | "switch";

/** An output as last declared by its agent (see docs/PROTOCOL.md). */
export interface AgentOutput {
  id: string;
  mode: OutputMode;
  /** Button with a long press configured. */
  long: boolean;
  /** Switch state as last known (stale while the agent is offline); null for buttons. */
  on: boolean | null;
  /** Id of the device bound to this output, if any. */
  deviceId: string | null;
}

/** Why an agent last started (docs/PROTOCOL.md §5.2). */
export type AgentResetReason = "power" | "watchdog" | "reset" | "software" | "brownout" | "unknown";
export const AGENT_RESET_REASONS: readonly AgentResetReason[] = ["power", "watchdog", "reset", "software", "brownout", "unknown"];

/** What an agent reports about itself (`info`, docs/PROTOCOL.md §5.2); every field is optional. */
export interface AgentInfo {
  platform?: string;
  host?: string;
  /** LAN IPv4 address. */
  ip?: string;
  ssid?: string;
  /** Wi-Fi signal, dBm. */
  rssi?: number;
  /** Seconds since the agent started, as of `infoAt`. */
  uptime?: number;
  reset?: AgentResetReason;
  /** Free memory, bytes. */
  mem?: number;
}

export interface AgentConnection {
  /** Start of the current connection; null while offline. */
  since: Millis | null;
  /** Address the agent connects from, as seen by the server (current or last connection). */
  ip: string | null;
  /** Connections opened in the last 24 hours, the current one included. */
  connections24h: number;
  /** End of the last connection and its WebSocket close code (1006: dropped without a close frame). */
  lastClose: { at: Millis; code: number } | null;
}

export interface AgentStats {
  /** Commands (wake, press, set) sent to this agent in the last 24 hours, and how many failed. */
  commands24h: number;
  failed24h: number;
  lastCommandAt: Millis | null;
}

/** Diagnostics of an agent: only for house owners and editors. */
export interface AgentDetails {
  /** Last `info` received (kept while offline), and when. */
  info: AgentInfo | null;
  infoAt: Millis | null;
  connection: AgentConnection;
  stats: AgentStats;
}

export interface Agent {
  id: string;
  houseId: string;
  name: string;
  online: boolean;
  firmware: string | null;
  lastSeen: Millis | null;
  outputs: AgentOutput[];
  createdAt: Millis;
  /** Null for members (network details are for whoever manages the house). */
  details: AgentDetails | null;
}

export interface AgentWithToken {
  agent: Agent;
  /** Shown only here: the server stores a hash. */
  token: string;
}

// ---------- devices ----------

export type DeviceAction = "wake" | "press" | "long_press" | "on" | "off";

export type DeviceActionConfig =
  /** Wake-on-LAN, sent by every online agent in the list. */
  | { type: "wol"; mac: string; agentIds: string[] }
  /** An output (button or switch) of an agent of the same house. */
  | { type: "output"; agentId: string; outputId: string };

export interface DeviceInput {
  name: string;
  /** IPv4 on the agents' LAN: enables the online/offline check. */
  ip: string | null;
  /** Check with a TCP connect to this port instead of ping (e.g. 3389 for Windows). */
  probePort: number | null;
  action: DeviceActionConfig;
}

export type DeviceConfig = Omit<DeviceInput, "name">;

export type Reach =
  | { state: "unknown"; reason: "no_ip" | "no_agents" | "not_checked"; checkedAt: Millis | null }
  | { state: "online" | "offline"; checkedAt: Millis }
  | { state: "waking"; checkedAt: Millis | null; wake: { startedAt: Millis; deadline: Millis; attempts: number } };

export interface OutputStatus {
  mode: OutputMode;
  long: boolean;
  /** Switch state (null for buttons, or when never reported). */
  on: boolean | null;
  /** The agent is online and still declares this output. */
  available: boolean;
}

export interface DeviceStatus {
  /** Network reachability, from probes. */
  reach: Reach;
  /** For output devices. */
  output: OutputStatus | null;
  /** An action can be sent right now (an agent able to perform it is online). */
  ready: boolean;
}

/** "shared": the device was shared directly with this user, who can only use it. */
export type DeviceAccess = Role | "shared";

export interface Device {
  id: string;
  houseId: string;
  houseName: string;
  name: string;
  access: DeviceAccess;
  kind: "wol" | "output";
  /** Actions available for this device, given its kind and its output's capabilities. */
  actions: DeviceAction[];
  status: DeviceStatus;
  /** MAC, IP and agents: only for house owners and editors. */
  config: DeviceConfig | null;
}

export interface DeviceShare {
  userId: string;
  username: string;
  createdAt: Millis;
}

export interface AgentResult {
  agentId: string;
  agentName: string;
  status: "ok" | "offline" | "timeout" | "error";
  err?: string;
}

export interface ActionResponse {
  status: DeviceStatus;
  /** Per-agent outcome: only for house owners and editors. */
  results?: AgentResult[];
}

export interface StatusMap {
  statuses: Record<string, DeviceStatus>;
}

// ---------- log ----------

export type LogOutcome = "ok" | "failed" | "waking" | "online" | "timeout";

export interface LogEntry {
  id: number;
  at: Millis;
  deviceId: string | null;
  deviceName: string;
  houseId: string;
  houseName: string;
  /** Null when the change came from the agent (a physical button) or the user was deleted. */
  actor: { id: string | null; username: string } | null;
  source: "user" | "agent";
  action: DeviceAction;
  outcome: LogOutcome;
  onlineAfterMs: number | null;
  /** Only for house owners and editors. */
  results: AgentResult[] | null;
}

// ---------- live events (GET /api/events, Server-Sent Events) ----------

export type ServerEvent =
  /** A device's status changed. */
  | { type: "device"; id: string; status: DeviceStatus }
  /** The list of visible devices (or their configuration) changed: refetch GET /devices. */
  | { type: "devices" }
  /** An agent connected, disconnected or changed its outputs: refetch its house's agents. */
  | { type: "agent"; id: string; houseId: string; online: boolean }
  /** The list of houses or memberships changed: refetch GET /houses. */
  | { type: "houses" };
