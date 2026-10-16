# Project structure

Awake: remote power control for home devices. A server on a VPS (users, houses, devices, sharing, log)
talks over an outbound WebSocket to agents in the LAN, which send Wake-on-LAN packets, probe devices and
drive relay outputs (buttons and switches). Browsers use the HTTP API (the web UI is not written yet).

```text
repo/
├── backend/          Node 24 + TypeScript 7 + Hono 4 — HTTP API, agent gateway (ws), SQLite
├── shared/           TypeScript — API types, error codes, zod validation (backend + future UI)
├── agents/
│   ├── README.md     list of agents, how to contribute one
│   └── go/           Go 1.27 — reference agent (PC, Raspberry Pi), simulated outputs
├── docs/PROTOCOL.md  agent ↔ server protocol v1: the only contract with the agents
├── Dockerfile        build stage (npm ci, esbuild) → node:24-alpine running backend/dist/index.js
├── docker-compose.yml
├── .env.example      every supported env var, documented; `.env` is git-ignored
└── Makefile          dev commands (run `make help`)
```

## Backend (`backend/src`)

```text
backend/src/
├── index.ts          entry: config, start, bootstrap-admin banner; `reset-password <user>` CLI
├── app.ts            wiring: db, hub, device service, event bus, Hono app, /agent WebSocket upgrade
├── config.ts         env → Config (PUBLIC_URL, registration, OAUTH_* providers, timings)
├── log.ts            leveled one-line logger
├── db.ts             SQLite schema (append-only migrations), backup before migrating
├── secrets.ts        random tokens, SHA-256 token hashes, scrypt passwords
├── ratelimit.ts      in-memory failure counters (per IP, per username, per agent IP)
├── errors.ts         ApiError → `{ error, field?, results? }`
├── access.ts         roles and device access (owner/editor/member/shared) — authorization rules
├── events.ts         EventBus: live events to the users who can see them (SSE)
├── agents/
│   ├── protocol.ts   message types, close codes, hello `outputs` validation (mirrors PROTOCOL.md)
│   └── hub.ts        AgentHub: auth, presence, wake/probe/press/set with ack timeouts, out_state
├── devices/
│   └── service.ts    DeviceService: status (reach + output), actions, check loop, action log;
│                     HubListener (persists declared outputs and switch changes)
├── auth/
│   ├── users.ts      user rows/views, creation, set-password links, bootstrap admin, CLI reset
│   ├── sessions.ts   cookie sessions (hashed, sliding), revocation, purge of expired rows
│   └── oauth.ts      OIDC discovery + GitHub, PKCE/state/nonce, identity from claims
└── api/
    ├── index.ts      /api router: Origin check, body limit, /health, /config, error handler
    ├── common.ts     Services, Env, readBody (zod → error codes), requireUser/requireAdmin, sameOrigin
    ├── auth.ts       /auth: login, register, logout, me, password, password links, OAuth start/callback
    ├── admin.ts      /admin/users
    ├── houses.ts     /houses, members, /houses/:id/agents, /agents/:id
    ├── devices.ts    /devices, /houses/:id/devices, actions, check/status, shares, /shared/:id
    └── activity.ts   /log, /events (SSE)
```

Tests (`backend/test`): end-to-end over HTTP/WebSocket against a real server on a temp dir with fast
timings; `helpers.ts` has a cookie-keeping `Client` and `FakeAgent` (speaks the protocol).

### API

All under `/api`; full reference in [backend/API.md](backend/API.md). Summary:

- Public: `GET /health`, `GET /config`
- `/auth/*`: login/register/logout/me/password, set-password links, `oauth/:provider/start|callback`,
  `DELETE identities/:provider`
- `/admin/users*`: list, create (password or link), patch (rename, admin, approve/disable), link, delete
- `/houses*`: houses, members, agents of a house, devices creation; `/agents/:id*`
- `/devices*`: list, `check`, `status`, `:id/action`, PUT/DELETE, `:id/shares*`; `/shared/:id`
- `/log`, `/events` (SSE)
- WebSocket `/agent` for agents (docs/PROTOCOL.md)

### Data and state

SQLite at `$DATA_DIR/awake.db` (WAL), schema in `backend/src/db.ts`; backups `awake.db.bak-v<n>-<time>`
are written next to it before each migration. Durable: users, identities, sessions, password links,
OAuth states (10 min), houses/members, agents, agent outputs (as last declared), devices, shares, action
log. In memory only: agent connections, reachability results and check loops (lost on restart: actions
still `waking` are closed as `ok` at startup), rate-limit counters, SSE subscribers.

### Configuration

Every variable, with defaults and meaning, is in [.env.example](.env.example): `PORT`, `PUBLIC_URL`,
`TRUST_PROXY`, `DATA_DIR`, `LOG_LEVEL`, `REGISTRATION_ENABLED`, `REGISTRATION_AUTO_APPROVE`,
`SESSION_TTL_DAYS`, `PASSWORD_LINK_TTL_HOURS`, `OAUTH_PROVIDERS` + `OAUTH_<ID>_{TYPE,ISSUER,CLIENT_ID,CLIENT_SECRET,LABEL,SCOPES}`.

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
    ├── client/     connection loop: hello/welcome, one writer goroutine, heartbeat, 3×hb silence,
    │               backoff (NextDelay) with close-code minimums; commands.go: wake/probe/press/set
    ├── outputs/    Manager (press timing, busy, switch state, change events) + Driver/Line interface;
    │               sim.go is the only driver (logs actions)
    ├── wol/        magic packet to 255.255.255.255 + directed broadcasts of local subnets; dry run
    ├── probe/      TCP connect (refused = up; Windows needs its own errno file); ICMP via IcmpSendEcho
    │               on Windows (no admin), pro-bing elsewhere (unprivileged, then privileged)
    └── console/    stdin commands simulating local buttons: toggle/on/off/press/status/help
```

Switch changes caused by `set` are reported only in its ack; every other change (console, future
physical inputs) becomes `out_state` while connected, and is carried by the next `hello` otherwise.
