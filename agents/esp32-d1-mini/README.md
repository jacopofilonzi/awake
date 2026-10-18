# Awake agent — ESP32 D1 mini

Firmware for the **ESP32 D1 mini** (ESP32-WROOM-32 in the Wemos D1 mini form factor, 4 MB flash, USB
through a CH340/CH9102/CP2104 adapter). It implements [docs/PROTOCOL.md](../../docs/PROTOCOL.md) v1:
Wake-on-LAN, ping and TCP probes, relay outputs (buttons and switches) and `info` (LAN IP, Wi-Fi network
and signal, uptime, last restart reason, free memory).

**Nothing is compiled in**: the same firmware file works for everyone. Wi-Fi, server, token and outputs
are entered on the board's **setup page**, from a phone, and kept in the board's flash.

## Install

Firmware is not published: build it from this repository (see *Build from source*). `make bin` writes
two files to `dist/`; one build works for any board, since nothing is configured at compile time, so
the files can be passed to whoever flashes the board:

| File | Flash at | When |
|---|---|---|
| `awake-agent-esp32-d1-mini-<version>-install.bin` | `0x0` | first installation, or to start over: it **wipes the saved setup** |
| `awake-agent-esp32-d1-mini-<version>-update.bin` | `0x10000` | updates: the setup is **kept** |

With the board on the same computer, `make upload PORT=COM5` builds and flashes in one step (it keeps
the setup). Otherwise, flash the files from a browser, with nothing to install:

1. Plug the board into a computer with a **data** USB cable (not a charge-only one). On Windows, if no
   new COM port appears, install the driver of the board's USB chip (CH340/CH9102 from wch-ic.com, or
   CP210x from silabs.com).
2. Open **https://espressif.github.io/esptool-js/** in Chrome or Edge (Web Serial: not Firefox/Safari).
3. **Connect**, pick the board's port. If it doesn't connect, hold the board's BOOT button (if it has
   one) while pressing Connect.
4. Under *Program*: flash address **`0x0`**, choose the `-install.bin` file, press **Program** (about a
   minute: the image covers the whole 4 MB flash). Wait for "Leaving…".
5. Press the board's **RST** button. The blue LED gives three flashes every two seconds: setup mode.

To **update** later: same steps, but the `-update.bin` file at address **`0x10000`**: the configuration is
kept. Flashing an `-install.bin` again, or *Erase Flash* in the same page, wipes it (the board goes back
to setup mode).

## Setup page

In setup mode the board opens the Wi-Fi network **`Awake-Setup-XXXX`**, password **`awake-setup`**.
Join it with a phone: the setup page opens by itself (otherwise browse to `http://192.168.4.1`).

| Field | |
|---|---|
| Wi-Fi network / password | The home network the board joins: **2.4 GHz** only (the ESP32 has no 5 GHz). |
| Server address | `wss://<your Awake server>/agent`, e.g. `wss://awake.example.com/agent`. |
| Agent token | Shown once when the agent is created in the web app (house → Agents → New agent). |
| Wake-on-LAN port | 9 (or 7). |
| Status LED | GPIO 2 is the board's blue LED. |
| Outputs | One per relay, see below. |

**Save and restart**: the board checks everything (an error says which field), saves and connects.

Setup mode starts when there is no configuration yet, when **RST is pressed twice** (the second press
within five seconds of the first), or when BOOT is held while the board starts. With a configuration
saved, setup mode gives up after 10 minutes without a visit and restarts the agent. Editing keeps the
saved Wi-Fi password and token when their fields are left empty.

## Outputs and wiring

The ESP32 pins are **3.3 V and source only a few mA: never drive a relay coil directly.** Use a relay
module with its own driver transistor/optocoupler (the common 1/2/4-channel modules, powered from 5 V,
whose input accepts 3.3 V), or an optocoupler.

- **Button**: a momentary press, e.g. a relay in parallel with a PC's power button (the two pins of the
  front-panel connector on the motherboard). *Press* is the short press (300 ms), *Long press* forces
  the PC off (5000 ms; 0 = none).
- **Switch**: stays on or off, e.g. a relay powering a socket. Optionally a **local push button** between
  a GPIO and GND toggles it (internal pull-up, debounced); the web app is told.

*On with LOW*: most relay modules switch on when their input is LOW; leave it checked unless the relay
clicks at the wrong moment. Usable GPIOs (as printed on the board, IO16 → 16): 2, 4, 5, 13, 14, 15, 16,
17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33. Good first choices for relays: **16, 17, 18, 19, 21, 22,
23**. GPIO 0 and 12 are refused (they decide how the chip boots), as are 6–11 (flash) and 34–39 (input only).

## Status LED

| | |
|---|---|
| Steady on | online |
| Double flash every 2 s | Wi-Fi OK, connecting to the server |
| Slow blink (1 s) | no Wi-Fi |
| Three flashes every 2 s | setup mode |
| Short flash every 3 s | stopped: the server doesn't speak this protocol version (update the firmware) |
| Fast blink | the saved outputs can't be used: setup mode is on |
| Off for an instant | a command arrived |

## Logs

At 115200 baud on the USB port. Without tools: in https://espressif.github.io/esptool-js/ use
*Console* → Connect, then press RST. With arduino-cli: `make monitor PORT=COM5`. Common lines:
`connection failed (TLS…)` (wrong server address, or the server's certificate is not valid),
`closed 4001: unknown token`, `connected as "<name>"`.

## Build from source

Needs [arduino-cli](https://arduino.github.io/arduino-cli/); the core (esp32:esp32 3.3.12) and
ArduinoJson are pinned in `awake-agent/sketch.yaml`:

```bash
make -C agents/esp32-d1-mini build         # compile
make -C agents/esp32-d1-mini bin           # dist/…-install.bin (0x0) and …-update.bin (0x10000)
make -C agents/esp32-d1-mini upload PORT=COM5
```

The partition table is `min_spiffs` (1.9 MB app, OTA slots; the app is flashed at `0x10000`, the setup
lives in NVS at `0x9000`). CI only checks that the firmware compiles: nothing is published.

## Code

| File | |
|---|---|
| `awake-agent.ino` | start: configuration, setup mode or agent, watchdog |
| `src/agent.cpp` | protocol: Wi-Fi, states, hello (with info), hb, 3×hb silence, commands, out_state, info every 5 min |
| `src/settings.cpp` | configuration (JSON in NVS): validation (server URL, token, usable pins), load, save |
| `src/portal.cpp` | setup mode: access point, captive DNS, setup page |
| `src/tls.cpp` | TLS with the certificate bundle built into the core (Let's Encrypt, Cloudflare… are trusted) |
| `src/net.cpp` | magic packet (limited + directed broadcast), ICMP via ESP-IDF ping, TCP probe |
| `src/ws_client.cpp`, `outputs.cpp`, `status_led.cpp`, `backoff.cpp` | shared design with the MKR WiFi 1010 agent |
| `src/sysinfo.cpp`, `watchdog.cpp`, `log.cpp`, `version.h` | reset reason, uptime, free heap; task watchdog (30 s); logs |
