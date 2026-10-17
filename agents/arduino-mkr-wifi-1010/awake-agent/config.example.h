// Awake agent configuration. Copy this file to config.h (git-ignored: it holds your Wi-Fi password and
// the agent token) and fill it in. `make config` does the copy.

#pragma once

#include "src/outputs.h"
#include "src/status_led.h"

// ---------- Wi-Fi (2.4 GHz only) ----------
#define WIFI_SSID "my-network"
#define WIFI_PASSWORD "my-password"

// ---------- Awake server ----------
// Production: the server's public name, port 443, AWAKE_TLS true (wss://, certificate validated).
// Development on the LAN: the PC running `make dev`, port 5173 (Vite), AWAKE_TLS false.
#define AWAKE_HOST "awake.example.com"
#define AWAKE_PORT 443
#define AWAKE_TLS true
#define AWAKE_PATH "/agent"

// Token shown once when the agent is created in the web UI (house → Agents → New agent).
#define AWAKE_TOKEN "awk_..."

// ---------- Wake-on-LAN ----------
#define WOL_PORT 9  // 7 also works for most network cards

// ---------- Outputs ----------
// What the server sees: id, mode, whether a long press exists and the switch state. Pins and durations
// stay here. Keep an id unchanged once a device uses it.
//
//   Button(id, pin, shortMs, longMs = 0, activeLow = false)
//     a momentary press, e.g. a relay across a PC's power button. longMs 0 = no long press.
//   Switch(id, pin, inputPin = NO_PIN, initialOn = false, activeLow = false)
//     stays on/off, e.g. a relay powering a device. inputPin: a push button between that pin and GND
//     that toggles it locally (internal pull-up, debounced); the server is told about it.
//
// Most relay modules switch on with LOW: set activeLow = true for them. Leave the array empty for an
// agent that only does Wake-on-LAN.
static const OutputConfig OUTPUTS[] = {
    // Examples:
    // Button("pc-power", 2, 300, 5000, true),  // relay on D2: 0.3 s press, 5 s long press (force off)
    // Switch("lamp", 3, 4, false, true),       // relay on D3, local push button on D4
};

// ---------- Status LEDs ----------
// Show the agent's state without a serial monitor (patterns in src/status_led.h; README).
//
//   StatusLed(pin, activeLow = false)
//     a single-colour LED: blink patterns.
//   RgbStatusLed(redPin, greenPin, bluePin, activeLow = false)
//     an RGB LED (with its resistors): the same patterns in colour. activeLow = true for common anode.
//
// Pins can't be shared with an output. Leave the array empty for no status LED.
static const StatusLedConfig STATUS_LEDS[] = {
    StatusLed(LED_BUILTIN),  // the on-board LED

    // RgbStatusLed(5, 6, 7),  // an external RGB LED on D5/D6/D7 (common cathode)
};
