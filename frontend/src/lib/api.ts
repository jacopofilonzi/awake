// The only module that talks to the backend. Types come from @awake/shared (the API contract);
// errors become ApiFailure carrying the stable error code, translated by the UI.

import type {
  HouseIcon,
  ActionResponse,
  AdminProvider,
  AdminUser,
  AdminUserCreated,
  Agent,
  AgentResult,
  AgentWithToken,
  Device,
  DeviceAction,
  DeviceInput,
  DeviceShare,
  ErrorCode,
  House,
  HouseMember,
  LogEntry,
  Me,
  PasswordLink,
  PasswordTokenInfo,
  ProviderDeleted,
  ProviderInput,
  ProviderType,
  PublicConfig,
  RegisterResponse,
  Role,
  ServerSettings,
  StatusMap,
} from "@awake/shared";

export const API_BASE = "/api";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "NETWORK",
    readonly field?: string,
    readonly results?: AgentResult[],
  ) {
    super(code);
  }
}

/** Called on 401 so the app can drop to the login page. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiFailure(0, "NETWORK");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized();
    throw new ApiFailure(res.status, data?.error ?? "INTERNAL", data?.field, data?.results);
  }
  return data as T;
}

const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, body: unknown = {}) => request<T>("POST", p, body);
const put = <T>(p: string, body: unknown) => request<T>("PUT", p, body);
const patch = <T>(p: string, body: unknown) => request<T>("PATCH", p, body);
const del = (p: string) => request<null>("DELETE", p);
const id = encodeURIComponent;

export const api = {
  config: () => get<PublicConfig>("/config"),

  auth: {
    me: () => get<Me>("/auth/me"),
    login: (username: string, password: string) => post<Me>("/auth/login", { username, password }),
    register: (username: string, password: string) => post<RegisterResponse>("/auth/register", { username, password }),
    logout: () => post<null>("/auth/logout"),
    changePassword: (currentPassword: string | undefined, newPassword: string) => post<Me>("/auth/password", { currentPassword, newPassword }),
    inspectLink: (token: string) => post<PasswordTokenInfo>("/auth/password-link/inspect", { token }),
    useLink: (token: string, password: string) => post<null>("/auth/password-link", { token, password }),
    unlink: (provider: string) => del(`/auth/identities/${id(provider)}`),
    /** Browser navigation, not fetch: the provider redirects back to `next`. */
    oauthUrl: (provider: string, mode: "login" | "link", next: string) =>
      `${API_BASE}/auth/oauth/${id(provider)}/start?mode=${mode}&next=${encodeURIComponent(next)}`,
  },

  houses: {
    list: () => get<House[]>("/houses"),
    create: (name: string, icon: HouseIcon) => post<House>("/houses", { name, icon }),
    update: (houseId: string, changes: { name?: string; icon?: HouseIcon }) => patch<House>(`/houses/${id(houseId)}`, changes),
    remove: (houseId: string) => del(`/houses/${id(houseId)}`),
    members: (houseId: string) => get<HouseMember[]>(`/houses/${id(houseId)}/members`),
    addMember: (houseId: string, username: string, role: Role) => post<HouseMember[]>(`/houses/${id(houseId)}/members`, { username, role }),
    setRole: (houseId: string, userId: string, role: Role) => patch<HouseMember[]>(`/houses/${id(houseId)}/members/${id(userId)}`, { role }),
    removeMember: (houseId: string, userId: string) => del(`/houses/${id(houseId)}/members/${id(userId)}`),
    agents: (houseId: string) => get<Agent[]>(`/houses/${id(houseId)}/agents`),
    createAgent: (houseId: string, name: string) => post<AgentWithToken>(`/houses/${id(houseId)}/agents`, { name }),
    createDevice: (houseId: string, input: DeviceInput) => post<Device>(`/houses/${id(houseId)}/devices`, input),
  },

  agents: {
    rename: (agentId: string, name: string) => patch<Agent>(`/agents/${id(agentId)}`, { name }),
    regenerateToken: (agentId: string) => post<AgentWithToken>(`/agents/${id(agentId)}/token`),
    remove: (agentId: string) => del(`/agents/${id(agentId)}`),
  },

  devices: {
    list: () => get<Device[]>("/devices"),
    statuses: () => get<StatusMap>("/devices/status"),
    check: (ids?: string[]) => post<StatusMap>("/devices/check", ids ? { ids } : {}),
    act: (deviceId: string, action: DeviceAction) => post<ActionResponse>(`/devices/${id(deviceId)}/action`, { action }),
    update: (deviceId: string, input: DeviceInput) => put<Device>(`/devices/${id(deviceId)}`, input),
    remove: (deviceId: string) => del(`/devices/${id(deviceId)}`),
    shares: (deviceId: string) => get<DeviceShare[]>(`/devices/${id(deviceId)}/shares`),
    share: (deviceId: string, username: string) => post<DeviceShare[]>(`/devices/${id(deviceId)}/shares`, { username }),
    unshare: (deviceId: string, userId: string) => del(`/devices/${id(deviceId)}/shares/${id(userId)}`),
    leaveShared: (deviceId: string) => del(`/shared/${id(deviceId)}`),
  },

  log: (opts: { houseId?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.houseId) q.set("houseId", opts.houseId);
    if (opts.limit) q.set("limit", String(opts.limit));
    return get<LogEntry[]>(`/log${q.size ? "?" + q : ""}`);
  },

  admin: {
    users: () => get<AdminUser[]>("/admin/users"),
    createUser: (body: { username: string; admin: boolean; credentials: { type: "password"; password: string } | { type: "link" } }) =>
      post<AdminUserCreated>("/admin/users", body),
    updateUser: (userId: string, body: { username?: string; admin?: boolean; status?: "active" | "disabled" }) =>
      patch<AdminUser>(`/admin/users/${id(userId)}`, body),
    passwordLink: (userId: string) => post<PasswordLink>(`/admin/users/${id(userId)}/password-link`),
    removeUser: (userId: string) => del(`/admin/users/${id(userId)}`),
    settings: () => get<ServerSettings>("/admin/settings"),
    saveSettings: (body: { registrationEnabled: boolean; autoApprove: boolean }) => put<ServerSettings>("/admin/settings", body),
    providers: () => get<AdminProvider[]>("/admin/providers"),
    createProvider: (body: ProviderInput) => post<AdminProvider>("/admin/providers", body),
    updateProvider: (providerId: string, body: ProviderInput) => put<AdminProvider>(`/admin/providers/${id(providerId)}`, body),
    removeProvider: (providerId: string) => request<ProviderDeleted>("DELETE", `/admin/providers/${id(providerId)}`),
    /** OIDC discovery check before saving; resolves when the issuer answers. */
    testProvider: (type: ProviderType, issuer: string | null) => post<null>("/admin/providers/test", { type, issuer }),
  },
};
