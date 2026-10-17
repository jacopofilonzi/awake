#pragma once

#include <stdint.h>

#include "outputs.h"

// Status LEDs: what the agent is doing, visible without a serial monitor. A single-colour LED shows it
// with blink patterns, an RGB LED (three pins, digital only) with the same patterns in colour:
//
//   no Wi-Fi           slow blink, 1 s on / 1 s off          red
//   connecting         double flash every 2 s                yellow
//   online             steady on                             green
//   stopped            short flash every 3 s                 red
//   config error       fast blink (200 ms)                   red
//   command received   off for 150 ms                        blue for 150 ms
//
// Driven by millis() from loop(). During Wi-Fi association (a blocking call) the agent ticks them from
// the watchdog feed callback, so the pattern keeps running.

struct StatusLedConfig {
  int8_t red;     // a single-colour LED: its pin
  int8_t green;   // NO_PIN for a single-colour LED
  int8_t blue;    // NO_PIN for a single-colour LED
  bool activeLow; // true when the pin sinks the LED (common-anode RGB)
};

constexpr uint8_t MAX_STATUS_LEDS = 4;

// Helpers for config.h.
constexpr StatusLedConfig StatusLed(int8_t pin, bool activeLow = false) {
  return StatusLedConfig{pin, NO_PIN, NO_PIN, activeLow};
}
constexpr StatusLedConfig RgbStatusLed(int8_t red, int8_t green, int8_t blue, bool activeLow = false) {
  return StatusLedConfig{red, green, blue, activeLow};
}

enum class AgentStatus : uint8_t { NO_WIFI, CONNECTING, ONLINE, STOPPED, CONFIG_ERROR };

namespace statusLeds {

// Validates the LEDs (logging what is wrong): pins set, none shared with each other or with an output
// or its local button. Initializes the pins. On failure no LED is driven.
bool begin(const StatusLedConfig* leds, uint8_t count, const OutputConfig* outputs, uint8_t outputCount);
void show(AgentStatus status);
// A command arrived: a short blip over the current pattern.
void activity();
// Call on every loop().
void tick();

}  // namespace statusLeds
