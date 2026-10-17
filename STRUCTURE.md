# Project structure

Awake: remote power control for home devices. A server on a VPS (users, houses, devices, sharing, log)
talks over an outbound WebSocket to agents in the LAN, which send Wake-on-LAN packets, probe devices and
drive relay outputs (buttons and switches). Users use a PWA (Svelte 5, "Sabbia" theme) served by the server.

```text
repo/
├── backend/          Node 24 + TypeScript 7 + Hono 4 — HTTP API, agent gateway (ws), SQLite
├── frontend/         Svelte 5 + Vite 8 + Tailwind 4 — PWA, "Sabbia" theme (glass, Manrope/Fraunces, Lucide), IT/EN
├── shared/           TypeScript — API types, error codes, zod validation (backend + UI)
├── agents/
│   ├── README.md     list of agents, how to contribute one
│   ├── go/           Go 1.27 — reference agent (PC, Raspberry Pi), simulated outputs
│   └── arduino-mkr-wifi-1010/  C++ (arduino-cli) — firmware for the MKR WiFi 1010, GPIO outputs
├── docs/PROTOCOL.md  agent ↔ server protocol v1: the only contract with the agents
├── Dockerfile        build stage (npm ci, vite, esbuild) → node:24-alpine: backend bundle + UI in /app/web
├── docker-compose.yml
├── .env.example      every supported env var, documented; `.env` is git-ignored
└── Makefile          dev commands (run `make help`)
```

## Backend (`backend/src`)

```text
backend/src/
├── index.ts          entry: config, start, bootstrap-admin banner; `reset-password <user>` CLI
├── app.ts            wiring: db, hub, device service, event bus, Hono app, SPA, /agent WebSocket upgrade
├── static.ts         serves the built UI (WEB_DIR) with SPA fallback; hashed assets cached forever
├── config.ts         env → Config (PUBLIC_URL, SECRET_KEY, timings)
├── settings.ts       server settings kept in the DB (registration enabled, auto approve)
├── log.ts            leveled one-line logger
├── db.ts             SQLite schema (append-only migrations), backup before migrating
├── secrets.ts        random tokens, SHA-256 token hashes, scrypt passwords, seal/open (AES-GCM, SECRET_KEY)
├── ratelimit.ts      in-memory failure counters (per IP, per username, per agent IP)
├── errors.ts         ApiError → `{ error, field?, results? }`
├── access.ts         roles and device access (owner/editor/member/shared) — authorization rules
├── events.ts         EventBus: live events to the users who can see them (SSE)
├── agents/
│   ├── protocol.ts   message types, close codes, hello `outputs` and `info` validation (mirrors PROTOCOL.md)
│   ├── hub.ts        AgentHub: auth, presence, wake/probe/press/set with ack timeouts, out_state,
│   │                 info (rate-limited), agent_sessions rows (close code the server used, else the agent's / 1006)
│   └── details.ts    Agent.details for owners/editors: last info, connections, command stats from action_log
├── devices/
│   └── service.ts    DeviceService: status (reach + output), actions, check loop, action log;
│                     HubListener (persists declared outputs and switch changes)
├── auth/
│   ├── users.ts      user rows/views, creation, set-password links, bootstrap admin, CLI reset
│   ├── sessions.ts   cookie sessions (hashed, sliding), revocation, purge of expired rows
│   └── oauth.ts      OAuthProviders: providers from the DB (secrets opened on use, cached
│                     discovery), OIDC + GitHub/GHE, PKCE/state/nonce, identity from claims
└── api/
    ├── index.ts      /api router: Origin check, body limit, /health, /config, error handler
    ├── common.ts     Services, Env, readBody (zod → error codes), requireUser/requireAdmin, sameOrigin
    ├── auth.ts       /auth: login, register, logout, me, password, password links, OAuth start/callback
    ├── admin.ts      /admin/users (mounts server.ts)
    ├── server.ts     /admin/settings, /admin/providers (CRUD, test, delete → accounts left without login)
    ├── houses.ts     /houses, members, /houses/:id/agents, /agents/:id
    ├── devices.ts    /devices, /houses/:id/devices, actions, check/status, shares, /shared/:id
    └── activity.ts   /log, /events (SSE)
```

Tests (`backend/test`): end-to-end over HTTP/WebSocket against a real server on a temp dir with fast
timings; `helpers.ts` has a cookie-keeping `Client` and `FakeAgent` (speaks the protocol, can send `info`).

### API

All under `/api`; full reference in [backend/API.md](backend/API.md). Summary:

- Public: `GET /health`, `GET /config`
- `/auth/*`: login/register/logout/me/password, set-password links, `oauth/:provider/start|callback`,
  `DELETE identities/:provider`
- `/admin/users*`: list, create (password or link), patch (rename, admin, approve/disable), link, delete
- `/admin/settings` (registration), `/admin/providers*` (login providers: list, test, create, update, delete)
- `/houses*`: houses, members, agents of a house, devices creation; `/agents/:id*`
- `/devices*`: list, `check`, `status`, `:id/action`, PUT/DELETE, `:id/shares*`; `/shared/:id`
- `/log`, `/events` (SSE)
- WebSocket `/agent` for agents (docs/PROTOCOL.md)

### Data and state

SQLite at `$DATA_DIR/awake.db` (WAL), schema in `backend/src/db.ts`; backups `awake.db.bak-v<n>-<time>`
are written next to it before each migration. Durable: settings (key → JSON), login providers (client
secret sealed with `SECRET_KEY`), users, identities, sessions, password links,
OAuth states (10 min), houses/members, agents (with the last info reported), agent outputs (as last declared), agent sessions (one row per
connection: ip, start, end, close code; closed rows pruned after 7 days, rows left open by a crash closed
at startup with 1001), devices, shares, action
log. In memory only: agent connections, reachability results and check loops (lost on restart: actions
still `waking` are closed as `ok` at startup), rate-limit counters, SSE subscribers.

### Configuration

Every variable, with defaults and meaning, is in [.env.example](.env.example): `PORT`, `PUBLIC_URL`,
`TRUST_PROXY`, `DATA_DIR`, `LOG_LEVEL`, `SECRET_KEY`, `SESSION_TTL_DAYS`, `PASSWORD_LINK_TTL_HOURS`,
`WEB_DIR`. Registration and login providers are not env vars: admins set them in the UI (Server page).

## Web UI (`frontend/src`)

Svelte 5 (runes) PWA, "Sabbia" theme: warm low-chroma palette on a gradient backdrop, translucent glass
panels, Manrope + Fraunces, Lucide icons; the admin area only swaps the accent to a muted slate
(`.scheme-admin`). TypeScript 6 here (svelte-check does not support 7 yet). In dev Vite
runs on :5173, listening on the LAN (`host: true`: board agents and phones connect to the PC's address), and proxies `/api` and `/agent` to :8080; in production the backend serves `frontend/dist`.

| Path | Responsibility |
| --- | --- |
| `main.ts`, `App.svelte` | mount; route guards (anonymous → /login, forced password change, admin only) |
| `app.css` | Tailwind 4: color tokens as CSS variables (light, dark, admin; glass, glow, backdrop) mapped by `@theme inline`; fonts; `@utility` components (glass, card, btn-filled/tonal/outlined/text, input…) |
| `lib/api.ts` | the only fetch layer, typed on `@awake/shared`; `ApiFailure` carries the error code |
| `lib/router.svelte.ts` | history router (path patterns → route names), `link` action |
| `lib/session.svelte.ts` | public config + current user, boot, logout |
| `lib/data.svelte.ts` | houses and devices kept live by `/api/events` (SSE); `version` (per house) and `actions` counters make pages refetch |
| `lib/i18n/` | `en.ts` defines the keys, `it.ts` must match (type-checked); `errors` must cover every `ErrorCode` |
| `lib/ui.svelte.ts` | snackbar, promise-based confirm dialog, error → text |
| `lib/format.ts` | device status/kind/icon, relative times, log lines |
| `lib/icons.ts` | the Lucide icons used (UI names → `lucide-static` SVGs, imported raw: only those are bundled) |
| `lib/actions.ts` | runs a device action (long-press confirmation, API, status into the store, errors) for tiles and the device page |
| `components/` | AppShell (glass sidebar with houses, or phone header + navigation dock; user or admin), TopBar, Dialog (native `<dialog>`, bottom sheet on phones), DeviceCard (tile with the glowing power button), DeviceActions, Switch, Segmented, Menu (popover, bottom sheet on phones), StatusPill, LogList… |
| `dialogs/` | short creation/edit flows: device, house, agent (+ token shown once), member/share (UsernameDialog), new user, password link, login provider (ProviderDialog: presets Google/Microsoft/GitHub/Authentik/Keycloak) |
| `pages/` | Login, Register, SetPassword (#token), ChangePassword, Home (welcome / redirect), House (+ HouseAgents, HouseMembers), Device, Shared, Activity, Account, admin/Users (flags accounts with no way to log in), admin/Server (registration settings, login providers) |

`mockups/` (git-ignored) holds the HTML mockups the design was chosen from.

## Go agent (`agents/go`)

Single static binary, no runtime. Own Makefile (`make -C agents/go check|test|build|cross`), which the
root Makefile delegates to; module `github.com/jacopofilonzi/awake/agents/go` (go 1.25 minimum, so an
older Go on a Pi can build it). Details in [agents/go/README.md](agents/go/README.md).

```text
agents/go/
├── cmd/awake-agent/main.go   flags, config, wiring, signals (Ctrl+C = close 1000, button released)
├── awake-agent.example.toml  documented config (copy to awake-agent.toml, git-ignored)
└── internal/
    ├── protocol/   message structs, close codes, validation (MAC, IPv4, output ids) — mirrors PROTOCOL.md
    ├── config/     TOML + env (AWAKE_SERVER, AWAKE_TOKEN, AWAKE_DRY_RUN) + validation; token redacted
    ├── client/     connection loop: hello (with info)/welcome, one writer goroutine, heartbeat, info
    │               every 5 min, 3×hb silence, backoff (NextDelay) with close-code minimums;
    │               commands.go: wake/probe/press/set; its HTTP transport records the LAN IPv4 of the
    │               connection (reported as info.ip, loopback omitted)
    ├── outputs/    Manager (press timing, busy, switch state, change events) + Driver/Line interface;
    │               sim.go is the only driver (logs actions)
    ├── wol/        magic packet to 255.255.255.255 + directed broadcasts of local subnets; dry run
    ├── probe/      TCP connect (refused = up; Windows needs its own errno file); ICMP via IcmpSendEcho
    │               on Windows (no admin), pro-bing elsewhere (unprivileged, then privileged)
    ├── sysinfo/    agent info (PROTOCOL.md §5.2): platform GOOS/GOARCH (+ board model from
    │               /proc/device-tree/model in model_linux.go), hostname, uptime
    └── console/    stdin commands simulating local buttons: toggle/on/off/press/status/help
```

Switch changes caused by `set` are reported only in its ack; every other change (console, future
physical inputs) becomes `out_state` while connected, and is carried by the next `hello` otherwise.

## Arduino agent (`agents/arduino-mkr-wifi-1010`)

Firmware for the MKR WiFi 1010 (SAMD21 + NINA-W102 Wi-Fi). Built with arduino-cli through its own
Makefile (`config|build|upload|monitor`, `PORT=COM8`); core and libraries pinned in `sketch.yaml`
(arduino:samd, WiFiNINA, ArduinoJson). Not part of `make check` (needs arduino-cli). No unit tests: it is
checked by compiling and by running it against `make dev`. Details in its README.

```text
agents/arduino-mkr-wifi-1010/awake-agent/
├── awake-agent.ino     setup/loop, watchdog; blinks on a configuration error
├── config.example.h    Wi-Fi, server, token, WoL port, OUTPUTS (Button/Switch helpers), STATUS_LEDS
│                       (StatusLed/RgbStatusLed helpers); copy to config.h (git-ignored)
├── sketch.yaml         arduino-cli profile: pinned core and libraries
└── src/
    ├── agent.cpp       protocol: Wi-Fi, states (waiting/awaiting welcome/online/stopped), hello (with
    │                   info), hb, 3×hb silence, wake/probe/press/set, out_state, info every 5 min
    ├── ws_client.cpp   minimal WebSocket client (8 KB messages, keeps close codes); ArduinoHttpClient's
    │                   truncates at 128 bytes and drops the close code
    ├── outputs.cpp     buttons timed with millis(), switches, debounced local buttons (INPUT_PULLUP)
    ├── status_led.cpp  status LEDs (single-colour or RGB): blink patterns/colours per agent state, command blip
    ├── net.cpp         magic packet (limited + directed broadcast), ICMP via the NINA module, TCP probe
    │                   (fast failure = refused = up: the module can't tell refused from timeout)
    ├── backoff.cpp     §8 delays with close-code minimums
    ├── sysinfo.cpp     info (§5.2): reset cause from PM->RCAUSE (read first in setup), uptime past the
    │                   millis() wrap, free RAM (stack − sbrk(0))
    └── watchdog.cpp, log.cpp, version.h
```
