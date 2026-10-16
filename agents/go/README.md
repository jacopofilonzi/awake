# Awake agent (Go)

The reference implementation of the [Awake agent protocol](../../docs/PROTOCOL.md). A single static
binary for Windows, Linux (including Raspberry Pi) and macOS. It keeps an outbound WebSocket connection to
the Awake server and, on request:

- sends **Wake-on-LAN** magic packets;
- **probes** a host once (ICMP echo, or TCP connect to a port);
- drives its **outputs**: `button` outputs (short/long press) and `switch` outputs (on/off), reporting
  local switch changes to the server.

It reconnects forever with exponential backoff and jitter, honouring the server's close codes.

## Build

Requires Go 1.25 or newer. From `agents/go/`:

```sh
make build                     # or: go build ./cmd/awake-agent
make build VERSION=1.2.3       # stamps the version (sent as fw "awake-agent-go/1.2.3")
make cross                     # dist/ binaries: linux arm64/armv7/armv6 (Raspberry Pi), linux amd64, darwin arm64, windows amd64
make check                     # gofmt check, go vet, go test
```

Without make: `go build -ldflags "-X main.version=1.2.3" ./cmd/awake-agent`; cross-compile with
`GOOS=linux GOARCH=arm GOARM=7 go build ./cmd/awake-agent` (no cgo needed).

## Run

1. In the web UI create an agent and copy its token (shown once).
2. Copy `awake-agent.example.toml` to `awake-agent.toml` and edit it.
3. Start it, giving the token through the environment so it never sits in a file:

```sh
AWAKE_TOKEN=awk_... ./awake-agent                 # Linux/macOS
$env:AWAKE_TOKEN = "awk_..."; .\awake-agent.exe   # PowerShell
```

| Flag | Default | Meaning |
|---|---|---|
| `-config path` | `awake-agent.toml` | Config file (relative to the working directory). If the default file is missing the agent runs on defaults + environment; an explicit `-config` that is missing is an error. |
| `-dry-run` | off | Log magic packets instead of sending them. Overrides the config and `AWAKE_DRY_RUN`. |
| `-console` | on when stdin is a terminal | Read simulated local commands from stdin (see below). |
| `-log-level` | `info` | `debug`, `info`, `warn` or `error`. Logs go to stderr. |
| `-version` | | Print the version and exit. |

| Env var | Overrides |
|---|---|
| `AWAKE_SERVER` | `server` |
| `AWAKE_TOKEN` | `token` |
| `AWAKE_DRY_RUN` | `dry_run` (`true`/`false`/`1`/`0`) |

Ctrl+C (SIGINT) or SIGTERM closes the connection cleanly (code 1000) and releases any button being
pressed. A second Ctrl+C kills the process immediately.

Exit codes: `0` stopped by a signal, `1` invalid configuration or the server closed with `4004`
(protocol version not supported: update the agent), `2` bad command-line flags.

## Configuration

See [`awake-agent.example.toml`](awake-agent.example.toml), which documents every key. The whole file is
validated at startup and every problem is reported at once; unknown keys are errors.

- `server`: `ws://` or `wss://` URL ending in `/agent`. Use `wss://` whenever the server is reachable
  from the internet; the agent warns at startup when a `ws://` URL points to a host that does not look
  local (localhost, private/link-local/CGNAT IPs, single-label names, `.local`/`.lan`/`.home.arpa`/`.internal`).
  TLS certificates are validated with the system roots.
- `token`: required (file or `AWAKE_TOKEN`). It is never logged: the startup log shows `token=(set)`.
- `[wol]`: `port` (default 9), `broadcast` (extra addresses), `auto_broadcast` (default `true`).
  Every magic packet goes to `255.255.255.255`, to the directed broadcast of each local IPv4 subnet
  (recomputed at every wake, so VPN/Wi-Fi changes are picked up) and to the extra addresses. A wake
  succeeds when at least one destination accepted the packet.
- `[[outputs]]`, at most 32:
  - `id`: 1–32 chars of `a-z 0-9 - _`, starting with a letter or digit, unique. Don't rename it once the
    server has devices bound to it.
  - `mode`: `button` or `switch`.
  - `driver`: `sim` (default and, for now, the only one).
  - buttons: `short_ms` (default 300), optional `long_ms` (must be greater than `short_ms`; without it
    the server only offers the short press). Both at most 60000.
  - switches: `initial` (default `false`), the state set at startup.

## Outputs and drivers

The protocol logic never touches hardware directly. `internal/outputs` has three layers:

- the **Manager** keeps the protocol state: which button is being pressed (a second press while busy is
  rejected with `busy`, whether it comes from the server or the local console), each switch's on/off,
  and who caused each change (`server` or `local`; only local changes are sent as `out_state`);
- a **Driver** opens one **Line** per output; a line only knows `SetActive(true/false)`;
- the **sim** driver implements lines that do nothing but log at debug level. The Manager logs every
  action at info level:

```
INFO output pressed id=pc-power press=short duration=300ms cause=server
INFO output released id=pc-power reason=done
INFO switch changed id=lamp on=true cause=server
```

A hardware driver (e.g. Raspberry Pi GPIO) is added by implementing `outputs.Driver` / `outputs.Line`
(with polarity and pin settings in `outputs.Spec` and the config), and registering it in
`outputs.DefaultDrivers`. Nothing in the client or protocol code changes.

## Console

On a PC there are no physical buttons, so the console simulates them. It is enabled by default when
stdin is a terminal (`-console=false` to disable, `-console` to force it, e.g. with piped input). End of
input only ends the console, never the agent.

| Command | Effect |
|---|---|
| `toggle <id>` | Flip a switch as a local button would. Sent to the server as `out_state` if connected; otherwise the next `hello` carries the state. |
| `on <id>` / `off <id>` | Turn a switch on/off locally (same reporting as `toggle`). |
| `press <id> [long]` | Press a button output locally. Nothing is sent (buttons have no state), but the output is busy for the duration. |
| `status` | Connection state and every output with its state. |
| `help` | List the commands. Unknown commands also print it. |

```sh
printf 'toggle lamp\nstatus\n' | AWAKE_TOKEN=awk_... ./awake-agent -console
```

## Probes

- **TCP** (`port` set): up when the connection succeeds **or is refused** (an RST proves the host is up).
- **ICMP**:
  - Windows: uses `IcmpSendEcho` (iphlpapi.dll), which works **without administrator rights**.
  - Linux/macOS: tries an unprivileged ICMP socket first, then a raw socket. On Linux the unprivileged
    socket needs the agent's group in `net.ipv4.ping_group_range`
    (`sudo sysctl -w net.ipv4.ping_group_range="0 2147483647"`), otherwise give the binary
    `sudo setcap cap_net_raw+ep ./awake-agent` or run it as root. If neither works the agent answers
    `err: "icmp unsupported"`; configure a TCP port for the device instead.
- The probe timeout from the server is clamped to 100 ms – 30 s (2 s when absent).

## Running as a service

Any supervisor works (systemd, a Windows service wrapper, launchd): run the binary with
`-console=false` and `AWAKE_TOKEN` in its environment. The agent needs no listening port and no
inbound firewall rule.

## Layout

```text
cmd/awake-agent/      flags, logging, wiring, signal handling
internal/protocol/    message structs, close codes, validation of MACs / IPv4 / output ids
internal/config/      TOML load, env overrides, validation, token redaction
internal/client/      connection loop, handshake, command dispatch, heartbeat, backoff
internal/outputs/     Manager, Driver/Line interfaces, sim driver
internal/wol/         magic packet, broadcast targets
internal/probe/       TCP probe, ICMP (icmp_windows.go / icmp_other.go)
internal/console/     stdin commands
```

## Protocol checklist (PROTOCOL.md §12)

- [x] Network connect with retry (OS-managed on a PC; no hardware watchdog on a PC: use a service
      supervisor with restart instead).
- [x] WebSocket client over TLS (`wss://`) with certificate validation; plain `ws://` for LAN setups.
- [x] Configurable: server URL, token, broadcast address(es), WoL port, outputs (id, mode, short/long press duration).
- [x] Sends `hello` with `v: 1`, the token, a firmware string and its outputs (with switch states) right after connecting.
- [x] Uses the `hb` value from `welcome`; sends heartbeats; reconnects after 3 × `hb` of silence.
- [x] Handles `wake`: builds the 102-byte packet, broadcasts it, replies `ack` within 5 s.
- [x] Handles `probe`: ICMP echo (or `err` if unsupported) and TCP connect (connected **or refused** = up), replies within `timeout` + 3 s.
- [x] Handles `press`: acks when the press starts, rejects `busy` while pressing, `no long press` when not configured.
- [x] Handles `set`: acks with the resulting `on`.
- [x] Sends `out_state` for every switch change not caused by `set`, only while connected.
- [x] Ignores unknown message types and fields.
- [x] Reconnects forever with exponential backoff + jitter, honouring the close codes of §7.
- [x] Never logs the token.
