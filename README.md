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
| [`frontend/`](frontend/) | Web UI: installable PWA (Svelte 5), Italian and English |
| [`shared/`](shared/) | API types, error codes and validation shared by backend and web UI |
| [`agents/`](agents/) | Agents: [`go/`](agents/go/) reference agent (PC, Raspberry Pi); boards to come |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | Agent ↔ server protocol: the contract every agent implements |

The server also serves the web UI: open `PUBLIC_URL` in a browser, and add it to the home screen to use it
as an app (installing requires HTTPS).

## Run the server

```bash
cp .env.example .env    # set PUBLIC_URL, TRUST_PROXY=true, SECRET_KEY
make up                 # pulls ghcr.io/jacopofilonzi/awake and starts it (docker compose)
make logs               # the first start prints the admin password
```

`docker-compose.yml` runs the image published by CI for every release (`linux/amd64` and `linux/arm64`);
it needs only `docker-compose.yml` and `.env` on the server, not the source. Set `AWAKE_VERSION` in `.env`
to pin a version (`0.2.0`, or `0.2` for its fixes); the default is `latest`. To build the image from the
source instead: `docker build -t awake .`.

On the first start Awake creates the user **`admin`** with a random password, printed once in the logs;
it must be changed at the first login. Lost it?

```bash
docker compose exec awake node index.js reset-password admin    # Docker
make reset-password ACCOUNT=admin                               # from the repository
```

Awake speaks plain HTTP on port 8080. **Expose it only through an HTTPS reverse proxy** (Caddy, Traefik,
nginx…), then set `PUBLIC_URL=https://…` and `TRUST_PROXY=true`. Behind Cloudflare (in front of your
proxy) also set `CLIENT_IP_HEADER=CF-Connecting-IP`, so rate limits and the agents' "connects from"
address see the real client IP (see `.env.example`). The proxy must also forward the WebSocket on
`/agent`; with Caddy it is automatic:

```
awake.example.com {
    reverse_proxy localhost:8080
}
```

### Accounts

- Admins create users with a password (to be changed at first login) or with a one-time set-password
  link to send them.
- **Administration → Server** decides whether people can sign up by themselves and whether new
  accounts are approved automatically or wait for an admin.
- **Login providers**: Google, GitHub (also Enterprise) and any OpenID Connect provider (Authentik,
  Keycloak, Microsoft Entra ID…), as many as you like, also several of the same kind. Admins add them in
  **Administration → Server**, which shows the redirect URI to register at the provider
  (`<PUBLIC_URL>/api/auth/oauth/<id>/callback`). Set `SECRET_KEY` in `.env` first: client secrets are
  stored encrypted with it. Users link a provider to their account from their settings; a provider
  creates new accounts only when "Allow new accounts" is on for it. Deleting a provider leaves accounts
  without a password unable to log in: **Users** marks them, and a password link gives them access again.

Every variable is documented in [.env.example](.env.example).

## Run an agent

1. In the web UI create a house, then **Agents → New agent**: copy the token (it is shown once).
2. Run an agent in your LAN with that token: the [Go agent](agents/go/) on a PC or Raspberry Pi, or a
   board-specific one from [agents/](agents/).
3. Add devices: Wake-on-LAN (MAC + the agents that send the packet) or bound to one of the agent's
   outputs; optionally an IP (and a TCP port for machines that ignore ping) to see whether they are on.

## Development

Requires Node.js ≥ 24, Go ≥ 1.27 and `make`. Run `make` to list every task.

```bash
make install
cp .env.example .env   # set PUBLIC_URL=http://localhost:5173 (the dev UI address)
make dev               # backend on :8080 + web UI with hot reload on http://localhost:5173
make agent             # Go agent with simulated outputs (creates agents/go/awake-agent.toml first)
make test              # backend end-to-end tests + agent tests
make check             # typecheck backend and UI, gofmt, go vet, go test
```

## Releasing

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `make check` and `make test` on every push
to `main` and on pull requests. To publish a version, bump it in `backend/src/version.ts` and
`backend/package.json`, commit, then tag it:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The tag runs [`release.yml`](.github/workflows/release.yml): the same checks, a check that the tag matches
the server version, then the Docker image `ghcr.io/jacopofilonzi/awake` tagged `0.2.0`, `0.2` and `latest`.

## Upgrade notes

Nothing yet: this is the first version.
