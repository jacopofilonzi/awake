# Awake agent protocol — v1

This document specifies how an **agent** (a microcontroller, a Raspberry Pi, a PC: any always-on device
on your LAN) talks to an Awake server. It is the **only contract** between the two: agents are written in
different languages (Go, C++ for Arduino…) and share no code with the server. Follow it to write an agent
for a board that has none yet.

The key words **MUST**, **SHOULD** and **MAY** are used as in RFC 2119.

The reference implementation is [`agents/go`](../agents/go): when in doubt, it is the authority.

---

## 1. Responsibilities

The agent is deliberately simple. It does a few things on request, and reports changes of its own outputs:

| Command | What the agent does |
|---|---|
| `wake`  | Sends a Wake-on-LAN magic packet for a MAC address. |
| `probe` | Checks once whether an IP answers (ICMP echo, or TCP connect to a port). |
| `press` | Presses a **button** output (short or long press). |
| `set`   | Turns a **switch** output on or off. |

**Outputs** are physical lines of the agent (relays, optocouplers, GPIO…) wired to devices that cannot be
woken over the network. The agent declares them; the server knows only their id, their mode and their
state, never pins, wiring or timings:

| Mode | Meaning | State |
|---|---|---|
| `button` | A momentary press, e.g. a relay across a PC's power button. The agent decides how long a short and a long press last; the long press is optional. | None |
| `switch` | Stays on or off until changed, e.g. a relay powering a device. It can change from the server (`set`) or locally (a physical button wired to the agent). | `on` / `off` |

Everything else lives on the server: which devices exist, their MAC/IP, which agents serve them, the check
loop after a wake (a `probe` every 10 s for up to 5 min), users, sharing, logs. An agent never stores
device data.

## 2. Transport

- The agent opens a **WebSocket** connection to `ws://<host>:<port>/agent`, or `wss://<host>/agent` when
  the server is behind an HTTPS reverse proxy. The connection is always initiated by the agent (outbound
  only), so no port needs to be opened on the home router.
- Every message is a **JSON object in a single text frame**, UTF-8, at most **8 KB**. Binary frames are a
  protocol error.
- Every message has a string field `t` (type). Field order does not matter.
- Receivers **MUST ignore** unknown fields and messages with an unknown `t` (forward compatibility),
  except during the handshake (§3).
- WebSocket-level ping/pong frames are not used; liveness is handled by application heartbeats (§6).
  Agents MAY still answer WebSocket pings if their library does it automatically.

## 3. Handshake

Immediately after the WebSocket opens, the agent **MUST** send `hello` as its first message:

```json
{
  "t": "hello",
  "v": 1,
  "token": "awk_…",
  "fw": "mkr1010/0.3.1",
  "outputs": [
    { "id": "pc-power", "mode": "button", "long": true },
    { "id": "lamp", "mode": "switch", "on": false }
  ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `v` | integer | yes | Protocol version implemented by the agent. This document is version `1`. |
| `token` | string | yes | The agent token shown once in the web UI when the agent is created (or its token regenerated). |
| `fw` | string | no | Free-form firmware identifier, max 64 chars, shown in the UI. |
| `outputs` | array | no | The agent's outputs (§5). Omitted or empty for an agent that only does Wake-on-LAN. |

Each output:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable identifier, unique within the agent: 1–32 chars of `a-z`, `0-9`, `-`, `_`, starting with a letter or digit. The server binds devices to it, so **don't change it** once in use. |
| `mode` | string | yes | `button` or `switch`. |
| `long` | boolean | no | `button` only: `true` if a long press is configured. Default `false`: the UI then offers only the short press. |
| `on` | boolean | `switch` only | Current state of the switch. |

At most **32** outputs. Invalid outputs (bad id, unknown mode, duplicate id, missing `on` on a switch)
make the whole `hello` invalid.

The server answers with `welcome`:

```json
{ "t": "welcome", "v": 1, "name": "mkr-living-room", "hb": 20 }
```

| Field | Meaning |
|---|---|
| `v` | Protocol version the server uses for this connection. |
| `name` | Name given to this agent in the web UI (for logs). |
| `hb` | Heartbeat interval in **seconds** (§6). |

Rules:
- The `hello` **MUST** arrive within **10 seconds**, otherwise the server closes with `4008`.
- If the first message is not a valid `hello`, the server closes with `4000`.
- An unknown token closes with `4001`. An unsupported `v` closes with `4004`.
- The agent **MUST NOT** send anything other than `hello` before receiving `welcome`, and the server
  sends no command before `welcome`.
- Only one connection per token is kept: when a second connection authenticates with the same token, the
  **older** one is closed with `4002`.
- Every `hello` replaces the outputs the server knows for this agent. Switch states in `hello` are the
  truth: if a switch changed while the agent was offline, the server learns it here.

## 4. Commands

Commands carry an `id` (opaque string, unique per command). The agent **MUST** copy it into its reply.
Commands can arrive at any time after `welcome`; the agent SHOULD process them concurrently or at least
never block heartbeats for longer than a few seconds.

Every command except `probe` is answered with an `ack`:

```json
{ "t": "ack", "id": "5f0c…", "ok": true }
{ "t": "ack", "id": "5f0c…", "ok": false, "err": "busy" }
```

- `err` is a short machine-friendly reason, max 64 chars, shown to the device owner. Recommended values:
  `unknown output`, `wrong mode`, `no long press`, `busy`, `send failed`, `invalid`.
- The `ack` **MUST** arrive within **5 seconds**, otherwise the server records a timeout for this agent.
- The agent **MUST NOT** queue or replay commands across reconnections: a command received on a
  connection that then drops is simply lost. The server never re-sends commands.

### 4.1 `wake`

```json
{ "t": "wake", "id": "5f0c…", "mac": "AA:BB:CC:DD:EE:FF" }
```

`mac` is always 6 uppercase hex bytes separated by `:`. The agent **MUST** broadcast a magic packet (§9)
and then reply `ack`. `ok: true` means *the packet was sent*, not that the device woke up: the server
verifies that with probes.

### 4.2 `probe`

```json
{ "t": "probe", "id": "91ab…", "ip": "192.168.1.20", "port": 3389, "timeout": 2000 }
```

| Field | Meaning |
|---|---|
| `ip` | IPv4 address on the agent's LAN. |
| `port` | Optional. When present, do a TCP connect to this port instead of an ICMP echo. |
| `timeout` | Milliseconds to wait for an answer. |

The agent performs **one** check and replies with `probe_result` (not `ack`):

```json
{ "t": "probe_result", "id": "91ab…", "up": true, "ms": 3 }
```

| Field | Meaning |
|---|---|
| `up` | `true` if the host answered. |
| `ms` | Optional round-trip time. |
| `err` | Optional. Set when the check **could not be performed** (e.g. ICMP not supported by the board). The server treats it as "not up". |

How to decide `up`:
- **ICMP** (no `port`): one echo request; `up` when an echo reply arrives within `timeout`.
- **TCP** (`port` set): open a connection; `up` when it **connects or is actively refused** (a TCP RST
  proves the host is running). `up: false` on timeout, host unreachable or no route. Close the
  connection immediately.
- If the board cannot do ICMP, it **SHOULD** reply `{ "up": false, "err": "icmp unsupported" }`; users
  can then configure a TCP port for the device.

The reply **MUST** arrive within `timeout` + 3 seconds.

### 4.3 `press`

```json
{ "t": "press", "id": "c2d1…", "out": "pc-power" }
{ "t": "press", "id": "c2d1…", "out": "pc-power", "long": true }
```

The agent presses the `button` output `out` for its configured short (or, with `long: true`, long)
duration.

- The `ack` is sent when the press **starts**, not when it ends: a long press may last longer than the
  5-second ack deadline.
- While an output is being pressed, another `press` on it **MUST** be rejected with `err: "busy"`.
- `ok: false` with `unknown output`, `wrong mode` (not a button) or `no long press` (long press not
  configured) when the command cannot be executed.

### 4.4 `set`

```json
{ "t": "set", "id": "77e0…", "out": "lamp", "on": true }
```

The agent turns the `switch` output `out` on or off, then replies with an `ack` that **MUST** carry the
resulting state:

```json
{ "t": "ack", "id": "77e0…", "ok": true, "on": true }
```

- Setting a switch to the state it already has is not an error: reply `ok: true`.
- On failure, `ok: false` with `err`, and `on` set to the current state when the agent knows it.

## 5. Events

### 5.1 `out_state`

When a switch changes **for any reason other than a `set` command** (a physical button wired to the
agent, a local schedule, a safety cut-off…), the agent **MUST** report it:

```json
{ "t": "out_state", "out": "lamp", "on": false }
```

- No reply is expected.
- A change caused by `set` is reported only through that command's `ack`, so the server can tell who
  changed the switch.
- Changes that happen while the agent is disconnected are not queued: the next `hello` carries the
  current state (§3).

## 6. Heartbeat and liveness

- After `welcome`, the agent **MUST** send `{ "t": "hb" }` every `hb` seconds.
- The server answers each heartbeat with `{ "t": "hb" }`.
- The server closes connections that have been silent for about **3 × `hb`** (65 s with the default 20 s).
- The agent **SHOULD** consider the connection dead when it has received **nothing** (any message) for
  **3 × `hb`**, close it and reconnect. This catches half-open TCP connections, which are common after
  Wi-Fi drops.

## 7. Close codes

| Code | Meaning | Agent behaviour |
|---|---|---|
| 1000/1001/1006… | Normal close, server restart, network error | Reconnect with backoff (§8). |
| 4000 | Protocol error (bad JSON, binary frame, no hello, invalid outputs) | Fix the firmware/config; reconnect with backoff. |
| 4001 | Unknown token | Retry no more often than every **5 minutes**. |
| 4002 | Replaced by a newer connection with the same token | Retry after **60 s** or more. Two agents must not share a token. |
| 4003 | Token revoked or agent deleted | Retry no more often than every **5 minutes**. |
| 4004 | Protocol version not supported | **Stop** reconnecting; the firmware needs an update. |
| 4008 | No hello within 10 s | Reconnect with backoff. |
| 4029 | Too many failed attempts from this IP | Retry no more often than every **5 minutes**. |

## 8. Reconnection

The agent **MUST** reconnect automatically forever (except after `4004`) using exponential backoff:

- first retry after **1 s**, doubling each time, capped at **60 s**;
- reset to 1 s after a successful `welcome`;
- apply **±20 % random jitter** to every delay, so that many agents do not reconnect at the same instant
  after a server restart;
- the special delays of §7 take precedence.

The agent SHOULD also reconnect when its network link comes back (e.g. Wi-Fi reassociation) and SHOULD
use a hardware watchdog so that a stuck TLS/Wi-Fi stack ends in a reboot rather than a silent hang.

Outputs keep working while the agent is disconnected: a local button still toggles its switch.

## 9. Wake-on-LAN magic packet

- Payload: **6 bytes `0xFF`** followed by the **target MAC repeated 16 times** — 102 bytes.
- Transport: **UDP**, destination port **9** (port 7 also works for most NICs; make it configurable).
- Destination address: a broadcast address of the LAN. Send it to the **limited broadcast
  `255.255.255.255`** and, when you know it, also to the **subnet directed broadcast** (e.g.
  `192.168.1.255`, computed as `ip | ~netmask`): some stacks/routers drop one of the two.
- Broadcast must be enabled on the socket (`SO_BROADCAST` or the library equivalent).

Example for `AA:BB:CC:DD:EE:FF`:

```
FF FF FF FF FF FF  AA BB CC DD EE FF  AA BB CC DD EE FF  … (16 times)
```

## 10. Security requirements

- **Use `wss://`** whenever the server is reachable from the internet. The token authenticates the agent;
  over plain `ws://` it can be sniffed. Plain `ws://` is acceptable only inside a trusted LAN or VPN.
- With TLS, the agent **SHOULD** validate the server certificate (most servers use Let's Encrypt: the
  ISRG Root X1 CA is enough). Skipping validation is only acceptable during development.
- Store the token in flash/config, never in logs. Treat it like a password.
- Validate commands: a `wake` MAC must be 6 bytes, a `probe` IP must be a well-formed IPv4 address, `out`
  must be one of the agent's outputs. Ignore or reject anything else.
- The agent only acts on its own LAN and its own outputs, and never opens listening ports.

## 11. Sequence example

```
Agent                                         Server
  │ ── WebSocket connect /agent ──────────────▶ │
  │ ── hello {v:1, token, outputs:[…]} ───────▶ │
  │ ◀── welcome {v:1, hb:20} ────────────────── │
  │ ── hb ────────────────────────────────────▶ │   every 20 s
  │ ◀── hb ──────────────────────────────────── │
  │                                             │   user presses "Wake"
  │ ◀── wake {id:"a", mac} ─────────────────── │
  │   (broadcast magic packet)                  │
  │ ── ack {id:"a", ok:true} ─────────────────▶ │
  │ ◀── probe {id:"b", ip, timeout} ────────── │   +10 s
  │ ── probe_result {id:"b", up:false} ───────▶ │
  │ ◀── probe {id:"c", ip, timeout} ────────── │   +20 s
  │ ── probe_result {id:"c", up:true} ────────▶ │   device online: the server stops probing
  │                                             │   user turns "lamp" on
  │ ◀── set {id:"d", out:"lamp", on:true} ──── │
  │ ── ack {id:"d", ok:true, on:true} ────────▶ │
  │   (physical button pressed)                 │
  │ ── out_state {out:"lamp", on:false} ──────▶ │   dashboard updates
```

## 12. Implementation checklist

- [ ] Wi-Fi/Ethernet connect with retry; hardware watchdog enabled.
- [ ] WebSocket client over TLS (`wss://`) with certificate validation; plain `ws://` optional for LAN setups.
- [ ] Configurable: server URL, token, broadcast address(es), WoL port, outputs (id, mode, short/long press duration).
- [ ] Sends `hello` with `v: 1`, the token, a firmware string and its outputs (with switch states) right after connecting.
- [ ] Uses the `hb` value from `welcome`; sends heartbeats; reconnects after 3 × `hb` of silence.
- [ ] Handles `wake`: builds the 102-byte packet, broadcasts it, replies `ack` within 5 s.
- [ ] Handles `probe`: ICMP echo (or `err` if unsupported) and TCP connect (connected **or refused** = up), replies within `timeout` + 3 s.
- [ ] Handles `press`: acks when the press starts, rejects `busy` while pressing, `no long press` when not configured.
- [ ] Handles `set`: acks with the resulting `on`.
- [ ] Sends `out_state` for every switch change not caused by `set`, only while connected.
- [ ] Ignores unknown message types and fields.
- [ ] Reconnects forever with exponential backoff + jitter, honouring the close codes of §7.
- [ ] Never logs the token.

When your implementation works, contribute it as `agents/<board-name>/` with a README explaining wiring,
flashing and configuration (see [agents/README.md](../agents/README.md)).
