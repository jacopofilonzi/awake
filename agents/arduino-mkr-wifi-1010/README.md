# Awake agent — Arduino MKR WiFi 1010

Firmware that turns an [Arduino MKR WiFi 1010](https://docs.arduino.cc/hardware/mkr-wifi-1010/) into an
always-on Awake agent: it keeps an outbound WebSocket to your Awake server, sends Wake-on-LAN packets,
checks whether devices are up and drives relay outputs. It implements [protocol v1](../../docs/PROTOCOL.md).

## What you need

- An Arduino MKR WiFi 1010 powered over USB (any phone charger) on your 2.4 GHz Wi-Fi.
- [arduino-cli](https://arduino.github.io/arduino-cli/) (or the Arduino IDE, see below).
- For outputs (optional): relay modules or optocouplers, see [Wiring](#wiring).

The board core and libraries are pinned in [`awake-agent/sketch.yaml`](awake-agent/sketch.yaml)
(`arduino:samd` 1.8.14, WiFiNINA 2.1.1, ArduinoJson 7.4.3): arduino-cli installs them on the first build.

## Build and flash

```bash
cd agents/arduino-mkr-wifi-1010
make config                  # creates awake-agent/config.h from the example
# edit awake-agent/config.h: Wi-Fi, server, token, outputs
make upload PORT=COM8        # compile and flash (Linux: PORT=/dev/ttyACM0)
make monitor PORT=COM8       # logs, 115200 baud
```

If `arduino-cli` is not on the PATH, pass it: `make upload ARDUINO_CLI="C:/Program Files/Arduino CLI/arduino-cli.exe" PORT=COM8`.

**Arduino IDE:** open `awake-agent/awake-agent.ino`, select the board *Arduino MKR WiFi 1010*, install
WiFiNINA and ArduinoJson (the versions above) from the Library Manager, copy `config.example.h` to
`config.h`, then Upload.

If an upload fails because the board is stuck, double-tap its reset button: the bootloader starts (the
LED pulses) and the port may change number.

## Configuration (`awake-agent/config.h`)

| Setting | Meaning |
|---|---|
| `WIFI_SSID`, `WIFI_PASSWORD` | Your 2.4 GHz network. |
| `AWAKE_HOST`, `AWAKE_PORT`, `AWAKE_TLS` | The server. Production: its public name, `443`, `true` (`wss://`, certificate validated). Development: the PC running `make dev`, `5173`, `false`. |
| `AWAKE_TOKEN` | The token shown once when you create the agent in the web UI (house → Agents → New agent). |
| `WOL_PORT` | UDP port of the magic packet, `9` (or `7`). |
| `OUTPUTS` | The outputs, see below. |
| `STATUS_LEDS` | LEDs showing the agent's state, see below. |

`config.h` is git-ignored: it holds your Wi-Fi password and the token. The token is never logged.

### Outputs

```cpp
static const OutputConfig OUTPUTS[] = {
    Button("pc-power", 2, 300, 5000, true),   // relay on D2: 0.3 s press, 5 s long press, active low
    Switch("lamp", 3, 4, false, true),        // relay on D3, local push button on D4, starts off
};
```

- `Button(id, pin, shortMs, longMs = 0, activeLow = false)`: a momentary press. With `longMs` 0 the web
  UI offers only the short press.
- `Switch(id, pin, inputPin = NO_PIN, initialOn = false, activeLow = false)`: stays on or off. A push
  button between `inputPin` and GND toggles it locally (internal pull-up, debounced) and the server
  is told. After a power cycle a switch starts in `initialOn`.

The server only learns the id, the mode, whether a long press exists and the switch state. Keep an id
unchanged once a device in the web UI uses it. At most 32 outputs; an empty array makes a
Wake-on-LAN-only agent. An invalid configuration is logged and the status LED blinks fast: the agent
doesn't connect.

### Status LEDs

```cpp
static const StatusLedConfig STATUS_LEDS[] = {
    StatusLed(LED_BUILTIN),    // the on-board LED
    RgbStatusLed(5, 6, 7),     // an external RGB LED on D5/D6/D7 (common cathode, with resistors)
};
```

- `StatusLed(pin, activeLow = false)`: a single-colour LED, blink patterns.
- `RgbStatusLed(red, green, blue, activeLow = false)`: an RGB LED, the same patterns in colour
  (digital pins, no PWM). `activeLow = true` for a common-anode LED.

| State | Single-colour LED | RGB LED |
|---|---|---|
| No Wi-Fi | slow blink, 1 s on / 1 s off | red, slow blink |
| Connecting to the server | double flash every 2 s | yellow, double flash |
| Online | steady on | green, steady |
| Stopped (the server doesn't support this protocol version) | short flash every 3 s | red, short flash |
| Configuration error | fast blink (200 ms) | red, fast blink |
| Command received | off for 150 ms | blue for 150 ms |

A status LED's pins can't be used by an output. An empty array means no status LED. Up to 4.

## Wiring

The MKR pins are **3.3 V and can source only a few mA**: never drive a relay coil directly.

- **Relay module** with its own driver transistor (the usual blue boards): VCC to 5V (or VCC for 3.3 V
  modules), GND to GND, IN to the output pin. Most switch on with LOW: use `activeLow = true`. Check
  that the module triggers reliably with a 3.3 V input.
- **PC power button**: put the relay contacts (COM/NO) or an optocoupler (e.g. PC817 with a ~330 Ω
  resistor on its LED side) in parallel with the button's two pins on the motherboard's front-panel
  header. An optocoupler is smaller and silent; mind its polarity on the motherboard side.
- **Mains loads** (lamps, sockets): use a relay module rated for it and an enclosure. Mains wiring is
  dangerous: if unsure, don't.
- **Local push button** for a switch: between the `inputPin` and GND, nothing else.

## Behaviour

- **Wake-on-LAN**: the magic packet goes to `255.255.255.255` and to the subnet broadcast, port `WOL_PORT`.
- **Probe**: an ICMP ping through the Wi-Fi module, or a TCP connect when the device has a port. The
  module can't tell "connection refused" from "timeout": a connection that fails within 0.5 s counts as
  refused (the host answered), so up.
- **Reconnection**: forever, 1 s doubling to 60 s with jitter; at least 5 minutes after an unknown or
  revoked token, 60 s when another agent took over the token; it stops for good on `4004` (protocol
  version not supported: update the firmware). Wi-Fi is re-joined automatically.
- **Self-description** (`info`, PROTOCOL.md §5.2): in every `hello` and then every 5 minutes while
  online, the board reports what the web UI shows on the agent: platform `arduino-mkr-wifi-1010`, its
  LAN IP, the Wi-Fi network (`WIFI_SSID`) and signal (RSSI, dBm), uptime in seconds (correct past
  millis()' 49-day wrap), free RAM in bytes (between heap and stack) and why it last started, read from
  the SAMD21's reset cause register: `power` (power-on), `brownout` (supply dropped), `reset` (reset
  button), `watchdog` (the 16 s watchdog fired: a hang), `software` (a reset requested by firmware, e.g.
  right after an upload over USB), `unknown`. No hostname: the board has none. The reset reason is also
  in the first log line.
- **Watchdog**: a hang of the Wi-Fi/TLS stack reboots the board after 16 s.
- **Logs** on the USB serial port at 115200 baud (`make monitor`), e.g.
  `12.345 INFO  [agent] connected as "mkr-living-room", heartbeat 20 s`.

## Wi-Fi module firmware

`wss://` needs a recent firmware in the board's Wi-Fi module (NINA-W102): it carries the root
certificates, Let's Encrypt's ISRG Root X1 included. The agent logs a warning at boot when the firmware
is older than the one WiFiNINA expects. To update it, close the serial monitor, then either use the
Arduino IDE (**Tools → Firmware Updater**) or
[arduino-fwuploader](https://github.com/arduino/arduino-fwuploader):

```bash
arduino-fwuploader firmware flash -b arduino:samd:mkrwifi1010 -a COM8
```

Then flash the agent again (the updater replaces the sketch).

## Protocol checklist (PROTOCOL.md §12)

- [x] Wi-Fi connect with retry; hardware watchdog enabled.
- [x] WebSocket client over TLS with certificate validation (by the Wi-Fi module); plain `ws://` for the LAN.
- [x] Configurable: server, token, WoL port, outputs (id, mode, short/long press). Broadcast addresses are
  derived from the Wi-Fi address and netmask.
- [x] `hello` with `v: 1`, token, firmware string and outputs with switch states.
- [x] Uses `hb` from `welcome`; heartbeats; reconnects after 3 × `hb` of silence.
- [x] `wake`: 102-byte packet, broadcast, `ack`.
- [x] `probe`: ICMP echo and TCP connect (connected or refused = up). Timeouts are capped at 10 s (watchdog).
- [x] `press`: ack at the start, `busy` while pressing, `no long press` when not configured.
- [x] `set`: ack with the resulting `on`.
- [x] `out_state` for local button changes, only while connected (changes before `welcome` are sent right after it).
- [x] `info` in `hello` and every 5 minutes: platform, IP, SSID, RSSI, uptime, reset reason, free RAM.
- [x] Ignores unknown message types and fields.
- [x] Reconnects forever with backoff and jitter, honouring the close codes.
- [x] Never logs the token.

## Code

| File | |
|---|---|
| `awake-agent/awake-agent.ino` | setup/loop, watchdog, config error blink |
| `awake-agent/src/agent.cpp` | the protocol: Wi-Fi, connection states, hello/welcome, heartbeats, commands |
| `awake-agent/src/ws_client.cpp` | minimal WebSocket client (keeps close codes, 8 KB messages) |
| `awake-agent/src/outputs.cpp` | buttons (timed with `millis()`), switches, debounced local buttons |
| `awake-agent/src/net.cpp` | magic packet, ping / TCP probe |
| `awake-agent/src/backoff.cpp` | reconnection delays |
| `awake-agent/src/sysinfo.cpp` | reset cause (`PM->RCAUSE`), uptime past the millis() wrap, free RAM |
| `awake-agent/src/watchdog.cpp`, `log.cpp`, `version.h` | SAMD21 watchdog, serial logs, firmware version |
