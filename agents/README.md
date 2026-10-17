# Agents

An **agent** is the always-on device on your LAN that sends Wake-on-LAN packets, checks whether your
devices are up and drives its physical outputs (relays wired to power buttons, sockets…). It keeps an
outbound WebSocket connection to the Awake server, so nothing has to be opened on your router.

| Agent | Runs on | Status |
|---|---|---|
| [`go/`](go/) | Windows, Linux, macOS, Raspberry Pi (a single binary, no runtime) | Reference implementation |
| [`arduino-mkr-wifi-1010/`](arduino-mkr-wifi-1010/) | Arduino MKR WiFi 1010 (C++, arduino-cli) | Wake-on-LAN, probes, relay outputs on GPIO |

More boards (ESP32, …) can be added as `agents/<board-name>/`.

## Writing an agent for a new board

Everything an agent must do is specified in **[docs/PROTOCOL.md](../docs/PROTOCOL.md)**: it is the only
contract with the server, there is no shared code. In short:

1. Connect to `wss://<your-server>/agent` and send `hello` with the token and your outputs.
2. Send `hb` at the interval given by the server.
3. On `wake`, broadcast a magic packet and reply `ack`.
4. On `probe`, ping the IP (or TCP-connect to the port) once and reply `probe_result`.
5. On `press` / `set`, drive the output and reply `ack`; report local switch changes with `out_state`.
6. Reconnect forever with backoff.

A contributed agent lives in `agents/<board-name>/` and brings:

- a `README.md`: supported hardware, wiring of the outputs, how to build/flash, how to configure the
  server URL, the token and the outputs;
- an example configuration with no real token or Wi-Fi password;
- the implementation checklist of PROTOCOL.md §12, ticked.

## Getting a token

In the web UI open a house → **Agents → New agent**, give it a name and copy the token: it is shown only
once. If you lose it, regenerate it (the old one stops working immediately). Wake-on-LAN devices can be
served by several agents of the same house: when you wake one, every online agent assigned to it sends
the packet, so two agents in the same LAN give you redundancy.
