# Awake

Self-hosted remote power control for your home devices. Keep power-hungry machines off and turn them on
from anywhere: with Wake-on-LAN, or with a relay wired to an always-on board for devices that can't be
woken over the network.

```
 Browser / PWA ──HTTPS──▶ Awake server (VPS) ◀──WebSocket (outbound)── Agent in your LAN ──▶ magic packet → PC, NAS…
                          users, houses,                                 microcontroller,     relay outputs → buttons, sockets
                          sharing, log                                   Raspberry Pi, PC
```

- **Server** (always on, e.g. a small VPS): users, houses, devices, sharing, log; tells agents what to do.
- **Agent** (always on, in your LAN): keeps an outbound connection to the server, so nothing has to be
  opened on your router. Sends magic packets, checks whether devices are up, and drives its **outputs**:
  - **button**: a momentary press (e.g. a relay across a PC's power button), short or long;
  - **switch**: stays on or off; it can also be changed from a physical button on the agent, and the
    dashboard follows.
- **Houses**: each user can have several houses (groups of agents and devices) and share a house
  (roles owner / editor / member) or a single device with other users.

## Repository

| Path | Content |
|---|---|
| [`backend/`](backend/) | Server: HTTP API, agent gateway, SQLite. [API reference](backend/API.md) |
| [`shared/`](shared/) | API types, error codes and validation shared with the (future) web UI |
| [`agents/`](agents/) | Agents: [`go/`](agents/go/) reference agent (PC, Raspberry Pi); boards to come |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | Agent ↔ server protocol: the contract every agent implements |

The web UI is not there yet.

## Run the server

```bash
cp .env.example .env    # set PUBLIC_URL, TRUST_PROXY=true, login providers…
make up                 # docker compose up -d --build
make logs               # the first start prints the admin password
```

On the first start Awake creates the user **`admin`** with a random password, printed once in the logs;
it must be changed at the first login. Lost it?

```bash
docker compose exec awake node index.js reset-password admin    # Docker
make reset-password ACCOUNT=admin                               # from the repository
```

Awake speaks plain HTTP on port 8080. **Expose it only through an HTTPS reverse proxy** (Caddy, Traefik,
nginx…), then set `PUBLIC_URL=https://…` and `TRUST_PROXY=true`. The proxy must also forward the
WebSocket on `/agent`; with Caddy it is automatic:

```
awake.example.com {
    reverse_proxy localhost:8080
}
```

### Accounts

- Admins create users with a password (to be changed at first login) or with a one-time set-password
  link to send them.
- `REGISTRATION_ENABLED=true` lets people sign up by themselves; with `REGISTRATION_AUTO_APPROVE=false`
  their account waits for an admin's approval.
- **Login providers**: Google, GitHub and any OpenID Connect provider (Authentik, Keycloak, Authelia…).
  Configure them with `OAUTH_PROVIDERS` and `OAUTH_<ID>_*` (see [.env.example](.env.example)); the
  redirect URI to register is `<PUBLIC_URL>/api/auth/oauth/<id>/callback`. Users link a provider to
  their account from their settings; an unknown provider account creates a new user only when
  registration is enabled.

Every variable is documented in [.env.example](.env.example).

## Run an agent

1. Create a house, then an agent in it: `POST /api/houses/:id/agents` (the token is shown once).
2. Run an agent in your LAN with that token: the [Go agent](agents/go/) on a PC or Raspberry Pi, or a
   board-specific one from [agents/](agents/).
3. Add devices: Wake-on-LAN (MAC + the agents that send the packet) or bound to one of the agent's
   outputs; optionally an IP (and a TCP port for machines that ignore ping) to see whether they are on.

## Development

Requires Node.js ≥ 24, Go ≥ 1.27 and `make`. Run `make` to list every task.

```bash
make install
make dev           # backend with reload on http://localhost:8080
make agent         # Go agent with simulated outputs (creates agents/go/awake-agent.toml first)
make test          # backend end-to-end tests + agent tests
make check         # typecheck, go vet, gofmt
```

Without a UI yet, try the API with any HTTP client keeping cookies, e.g. curl:

```bash
curl -c jar -H 'content-type: application/json' -d '{"username":"admin","password":"…"}' localhost:8080/api/auth/login
curl -b jar -c jar -H 'content-type: application/json' -d '{"currentPassword":"…","newPassword":"…"}' localhost:8080/api/auth/password
curl -b jar -H 'content-type: application/json' -d '{"name":"Home"}' localhost:8080/api/houses
curl -b jar -H 'content-type: application/json' -d '{"name":"pc"}' localhost:8080/api/houses/<house id>/agents
```

## Upgrade notes

Nothing yet: this is the first version.
