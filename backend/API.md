# Awake HTTP API

Base path: `/api`. Bodies are JSON. TypeScript types for every shape live in
[`shared/src/api.ts`](../shared/src/api.ts), validation in [`shared/src/validation.ts`](../shared/src/validation.ts).
The agent WebSocket (`/agent`) is specified in [docs/PROTOCOL.md](../docs/PROTOCOL.md).

## Authentication and security

- **Sessions**: login sets an HttpOnly cookie (`awake_session`, or `__Host-awake_session` with `Secure`
  when `PUBLIC_URL` is https), `SameSite=Lax`, sliding expiry (`SESSION_TTL_DAYS`). The database stores
  only a hash of the token.
- **CSRF**: state-changing requests (POST, PUT, PATCH, DELETE) with an `Origin` other than `PUBLIC_URL`
  get `403 FORBIDDEN`; a body must be `application/json`.
- **Password change required**: a user created by an admin with a password, and the bootstrap `admin`,
  get `403 PASSWORD_CHANGE_REQUIRED` everywhere except `GET /auth/me`, `POST /auth/password`,
  `POST /auth/logout`.
- **Rate limiting**: 10 failures in 10 minutes per IP (logins, password links, registrations) → `429
  RATE_LIMITED`; also 50 failed logins per hour per username. Agents have their own per-IP limit. Behind
  a reverse proxy set `TRUST_PROXY=true`.
- Passwords: 10–256 characters, stored with scrypt.

## Errors

Errors never contain human-readable text; the UI translates the code.

```json
{ "error": "INVALID_MAC", "field": "action.mac" }
```

The full list is in [`shared/src/errors.ts`](../shared/src/errors.ts). A resource the user cannot see is
always `404 NOT_FOUND` (never `403`), so ids of other people's houses and devices are not confirmed.
`ACTION_FAILED` (502) carries `results` (per-agent outcome) for house owners and editors.

## Public

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ "ok": true }` |
| GET | `/config` | `PublicConfig`: `{ version, protocolVersion, registration: { enabled, autoApprove }, providers: [{ id, label }] }` |

## Account (`/auth`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{ username, password }` | `Me` + session cookie. `INVALID_CREDENTIALS`, `ACCOUNT_PENDING`, `ACCOUNT_DISABLED` |
| POST | `/auth/register` | `{ username, password }` | `201 { status: "active", me }` + cookie, or `202 { status: "pending" }`. `REGISTRATION_DISABLED` |
| POST | `/auth/logout` | | 204 |
| GET | `/auth/me` | | `Me` `{ user, identities }` |
| POST | `/auth/password` | `{ currentPassword?, newPassword }` | `Me`. `currentPassword` required when the account has a password. Ends the user's other sessions |
| POST | `/auth/password-link/inspect` | `{ token }` | `{ username, expiresAt }` — for the set-password page |
| POST | `/auth/password-link` | `{ token, password }` | 204. One use; ends every session of that user |
| DELETE | `/auth/identities/:provider` | | `Me`. `LAST_LOGIN_METHOD` if it is the only way to log in |

Usernames: 3–32 chars of `a-z 0-9 . _ -`, starting with a letter or digit, case-insensitive.

### Login providers

Browser navigations, not fetch calls:

| Path | |
|---|---|
| `GET /auth/oauth/:provider/start?mode=login&next=/path` | Redirects to the provider. |
| `GET /auth/oauth/:provider/start?mode=link&next=/settings` | Links the provider to the logged-in account. |
| `GET /auth/oauth/:provider/callback` | Redirect URI to register at the provider: `<PUBLIC_URL>/api/auth/oauth/<id>/callback`. |

The callback redirects to `PUBLIC_URL + next` (a same-site path), with `?error=<code>` on failure
(`OAUTH_FAILED`, `OAUTH_NOT_LINKED`, `ACCOUNT_PENDING`, `ACCOUNT_DISABLED`, `IDENTITY_IN_USE`,
`UNAUTHORIZED`) or `?linked=<provider>` after linking.

- An identity is matched only by provider + subject, **never by email**: a provider account becomes a
  login for an existing user only when that user links it from their account.
- An unknown identity creates a new account only when the provider has `allowSignup` (active or pending
  as per the `autoApprove` setting), otherwise `OAUTH_NOT_LINKED`. Providers are managed under
  `/admin/providers`; a disabled or deleted one gives `PROVIDER_NOT_FOUND`, and `SECRET_KEY_MISSING`
  when the server has no `SECRET_KEY`.

## Admin (`/admin`, admins only)

Admins manage accounts, not data: they do not see other users' houses or devices.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/admin/users` | | `AdminUser[]` (pending first) |
| POST | `/admin/users` | `{ username, admin?, credentials: { type: "password", password } \| { type: "link" } }` | `201 { user, link? }`. With a password the user must change it at first login; with `link` the response carries a one-time set-password URL (shown only here) |
| PATCH | `/admin/users/:id` | `{ username?, admin?, status?: "active" \| "disabled" }` | `AdminUser`. Approve a pending user with `status: "active"`; disabling ends their sessions |
| POST | `/admin/users/:id/password-link` | | `PasswordLink` `{ url, expiresAt }` — invite again or reset a password; previous links stop working |
| DELETE | `/admin/users/:id` | | 204. Every house they own (also co-owned ones) is deleted with everything in it |

`LAST_ADMIN`: the last active admin cannot be demoted, disabled or deleted. `CANNOT_TARGET_SELF`:
admins cannot demote, disable or delete themselves. `AdminUser.canLogIn` is false for an account with no
password and no enabled provider (e.g. its provider was deleted): a password link is its way back in.

### Server settings and login providers

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/admin/settings` | | `ServerSettings` `{ registrationEnabled, autoApprove, secretKeyConfigured }` |
| PUT | `/admin/settings` | `{ registrationEnabled, autoApprove }` | `ServerSettings`. `autoApprove` also applies to accounts created by a provider |
| GET | `/admin/providers` | | `AdminProvider[]` `{ id, label, type, issuer, clientId, scopes, enabled, allowSignup, redirectUri, linkedUsers, createdAt }` — never the secret |
| POST | `/admin/providers/test` | `{ type, issuer }` | 204 when OIDC discovery at `issuer` works, `PROVIDER_UNREACHABLE` otherwise |
| POST | `/admin/providers` | `ProviderInput` `{ id, label, type: "oidc" \| "github", issuer, clientId, clientSecret, scopes, enabled?, allowSignup? }` | `201 AdminProvider`. `PROVIDER_ID_TAKEN`, `SECRET_KEY_MISSING`; `issuer` required for `oidc`, optional GitHub Enterprise URL for `github` |
| PUT | `/admin/providers/:id` | `ProviderInput` without `id` | `AdminProvider`. An empty `clientSecret` keeps the stored one |
| DELETE | `/admin/providers/:id` | | `{ withoutLogin: string[] }`: its identities are removed; usernames listed are left with no way to log in |

Client secrets are stored sealed with AES-256-GCM under a key derived from `SECRET_KEY`.

## Houses

Roles: **owner** (everything, members included), **editor** (agents and devices), **member** (sees and
uses devices).

| Method | Path | Body | Response | Who |
|---|---|---|---|---|
| GET | `/houses` | | `House[]` `{ id, name, icon, role, createdAt }` | |
| POST | `/houses` | `{ name, icon? }` | `201 House` (caller is owner) | anyone |
| PATCH | `/houses/:id` | `{ name?, icon? }` (at least one) | `House` | owner |
| DELETE | `/houses/:id` | | 204 — agents disconnected, devices, shares and log deleted | owner |
| GET | `/houses/:id/members` | | `HouseMember[]` | member |
| POST | `/houses/:id/members` | `{ username, role }` | `201 HouseMember[]`. Replaces direct shares of the house's devices | owner |
| PATCH | `/houses/:id/members/:userId` | `{ role }` | `HouseMember[]` | owner |
| DELETE | `/houses/:id/members/:userId` | | 204 | owner, or the member leaving |

`LAST_OWNER`: a house always keeps at least one owner.

`icon` is one of `HOUSE_ICONS` (`shared/src/api.ts`): `house` (default), `building-2`, `building`,
`house-heart`, `waves`, `mountain`, `trees`, `store`, `warehouse`, `wrench`, `server`, `school`; anything else
is `400 VALIDATION`.

## Agents

| Method | Path | Body | Response | Who |
|---|---|---|---|---|
| GET | `/houses/:id/agents` | | `Agent[]` with `online`, `firmware`, `lastSeen`, `outputs`, `details` (owners and editors only) | member |
| POST | `/houses/:id/agents` | `{ name }` | `201 { agent, token }` — **the token is shown only here** | editor |
| PATCH | `/agents/:id` | `{ name }` | `Agent` | editor |
| POST | `/agents/:id/token` | | `{ agent, token }` — the old token stops working, the agent is disconnected | editor |
| DELETE | `/agents/:id` | | 204 — WoL devices lose it, devices bound to its outputs become unbound | editor |

`outputs` are what the agent declared in its last `hello`: `{ id, mode: "button" | "switch", long, on,
deviceId }`. The server never configures them.

`details` (diagnostics) is filled only for house owners and editors; members get `null`:

- `info`, `infoAt`: the last `info` the agent reported (docs/PROTOCOL.md §5.2: `platform`, `host`,
  `ip`, `ssid`, `rssi`, `uptime`, `reset`, `mem`, each optional), kept while the agent is offline;
  `null` if it never sent one.
- `connection`: `since` (start of the current connection, `null` while offline), `ip` (address the
  agent connects from, as seen by the server, for the current or last connection), `connections24h`
  (connections opened in the last 24 hours, the current one included), `lastClose` (`{ at, code }` of the
  last connection that ended: the WebSocket close code, the server's own when it closed it — `4002`
  replaced, `4003` revoked, `1001` server stopped — and `1006` when it dropped without a close frame,
  including a silent agent dropped by the server). Connections are kept for 7 days.
- `stats`: `commands24h` and `failed24h` (actions of the log sent to this agent in the last 24 hours,
  and those whose result for this agent was not `ok`), `lastCommandAt`.

## Devices

A device belongs to a house and has one action:

- **Wake-on-LAN**: `{ type: "wol", mac, agentIds }` — every online agent in the list sends the packet.
- **Output**: `{ type: "output", agentId, outputId }` — a button (press, long press if the agent has one)
  or a switch (on/off) of an agent of the same house. One device per output.

`ip` (optional) enables the online/offline check; `probePort` checks with a TCP connect instead of ping.

| Method | Path | Body | Response | Who |
|---|---|---|---|---|
| GET | `/devices` | | `Device[]` — every device of the user's houses plus those shared with them | |
| POST | `/houses/:id/devices` | `DeviceInput` | `201 Device` | editor |
| PUT | `/devices/:id` | `DeviceInput` | `Device` | editor |
| DELETE | `/devices/:id` | | 204 | editor |
| POST | `/devices/:id/action` | `{ action: "wake" \| "press" \| "long_press" \| "on" \| "off" }` | `ActionResponse { status, results? }` | any access |
| POST | `/devices/check` | `{ ids?: string[] }` | `{ statuses }` — probes now (results younger than 10 s reused, concurrent checks merged) | |
| GET | `/devices/status` | | `{ statuses }` — cached only, never probes | |

`DeviceInput`:

```json
{ "name": "PC", "icon": "monitor", "ip": "192.168.1.20", "probePort": 3389, "action": { "type": "wol", "mac": "aa-bb-cc-dd-ee-ff", "agentIds": ["…"] } }
```

`icon` is one of `DEVICE_ICONS` (`shared/src/api.ts`): `monitor`, `laptop`, `server`, `hard-drive`,
`printer`, `tv`, `gamepad-2`, `router`, `lightbulb`, `lamp`, `plug`, `fan`, `heater`, `air-vent`, `cctv`,
`speaker`, `coffee`, `refrigerator`, `washing-machine`, `door-closed`; or `null` (the default: automatic,
the UI picks one by kind). Anything else is `400 VALIDATION`. `PUT` replaces the whole input, so a body
without `icon` sets it back to automatic.

`Device`: `{ id, houseId, houseName, name, icon, access, kind, actions, status, config }`. `access` is the
user's role in the house, or `"shared"`; `icon` is returned to everyone who sees the device (`null` =
automatic); `config` (MAC, IP, agents) only for owners and editors;
`actions` lists what can be sent given the kind and the output's capabilities.

`DeviceStatus`:

```json
{
  "reach": { "state": "waking", "checkedAt": null, "wake": { "startedAt": 0, "deadline": 0, "attempts": 3 } },
  "output": { "mode": "switch", "long": false, "on": true, "available": true },
  "ready": true
}
```

| `reach.state` | Meaning |
|---|---|
| `unknown` | `reason`: `no_ip`, `no_agents` (no capable agent online), `not_checked` |
| `online` / `offline` | Result of the last check (`checkedAt`) |
| `waking` | After a wake (or a short press of a button whose device is not known online): checked every 10 s for up to 5 min |

There is **no background polling**: devices are probed only when a user asks or after an action. Switch
states are pushed by agents, so they are always current while the agent is online.

Action errors: `ACTION_NOT_SUPPORTED`, `ALREADY_WAKING`, `NO_AGENTS_ASSIGNED`, `NO_AGENTS_ONLINE`,
`AGENT_OFFLINE`, `OUTPUT_UNAVAILABLE` (the agent no longer declares the output), `ACTION_FAILED`.
Configuration errors: `INVALID_MAC`, `INVALID_IP`, `INVALID_PORT`, `AGENT_NOT_IN_HOUSE`,
`OUTPUT_NOT_FOUND`, `OUTPUT_IN_USE`.

### Sharing a single device

The user it is shared with sees it right away (no acceptance step) and can only use it: no config, no
per-agent results, no agents.

| Method | Path | Body | Response | Who |
|---|---|---|---|---|
| GET | `/devices/:id/shares` | | `DeviceShare[]` | editor |
| POST | `/devices/:id/shares` | `{ username }` | `201 DeviceShare[]`. `USER_NOT_FOUND`, `ALREADY_SHARED`, `ALREADY_HAS_ACCESS` (already a house member), `CANNOT_TARGET_SELF` | editor |
| DELETE | `/devices/:id/shares/:userId` | | 204 | editor |
| DELETE | `/shared/:id` | | 204 — the recipient removes it from their list | recipient |

## Log

| Method | Path | Response |
|---|---|---|
| GET | `/log?houseId=&limit=50` | `LogEntry[]` (max 200), newest first |

House members see their houses' whole log; users a device is shared with see their own actions on it.
`source`: `user`, or `agent` for a switch changed on the agent's side (physical button, or while it was
offline). `outcome`: `ok`, `failed`, `waking`, `online` (with `onlineAfterMs`), `timeout`. Per-agent
`results` only for owners and editors.

## Live events

`GET /events` is a Server-Sent Events stream (use `EventSource`). Each message's `event` is its `type`:

| type | Data | Do |
|---|---|---|
| `ready` | `{}` | Stream open. |
| `device` | `{ id, status }` | Replace that device's status. |
| `devices` | | Refetch `GET /devices`. |
| `agent` | `{ id, houseId, online }` | Refetch that house's agents (sent on connect, disconnect and new `info`). |
| `houses` | | Refetch `GET /houses`. |

Streams end after 15 minutes (and when the session is revoked); `EventSource` reconnects by itself.
