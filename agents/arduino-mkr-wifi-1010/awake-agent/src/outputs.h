#pragma once

#include <stdint.h>

// The agent's outputs (PROTOCOL.md §1): pins driving relays, optocouplers or LEDs. The server only ever
// sees id, mode, whether a long press exists and the switch state; pins and timings stay here.
//
// - button: a momentary press (e.g. a relay across a PC's power button), short and optionally long.
//   Presses are timed with millis(), never with delay(), so heartbeats keep flowing during a long press.
// - switch: stays on or off. An optional local push button (wired between inputPin and GND, internal
//   pull-up) toggles it; those changes are reported to the server as out_state.

constexpr int8_t NO_PIN = -1;
constexpr uint8_t MAX_OUTPUTS = 32;  // protocol limit

enum OutputMode : uint8_t { OUTPUT_MODE_BUTTON, OUTPUT_MODE_SWITCH };

struct OutputConfig {
  const char* id;     // 1–32 chars of a-z 0-9 - _, starting with a letter or digit. Don't change it once in use.
  OutputMode mode;
  int8_t pin;         // pin driving the relay/LED
  bool activeLow;     // true for relay boards that switch on with LOW
  uint16_t shortMs;   // button: short press duration
  uint16_t longMs;    // button: long press duration, 0 = no long press
  int8_t inputPin;    // switch: local push button to GND, NO_PIN if none
  bool initialOn;     // switch: state at power on
};

// Helpers for config.h.
constexpr OutputConfig Button(const char* id, int8_t pin, uint16_t shortMs, uint16_t longMs = 0, bool activeLow = false) {
  return OutputConfig{id, OUTPUT_MODE_BUTTON, pin, activeLow, shortMs, longMs, NO_PIN, false};
}
constexpr OutputConfig Switch(const char* id, int8_t pin, int8_t inputPin = NO_PIN, bool initialOn = false, bool activeLow = false) {
  return OutputConfig{id, OUTPUT_MODE_SWITCH, pin, activeLow, 0, 0, inputPin, initialOn};
}

class Outputs {
 public:
  // Called when a switch changes for a reason other than set() (its local button).
  using LocalChangeFn = void (*)(uint8_t index, bool on);

  enum Result : uint8_t { OK, BUSY, NO_LONG_PRESS, WRONG_MODE };

  // Validates the configuration (logging what is wrong) and initializes the pins.
  bool begin(const OutputConfig* config, uint8_t count, LocalChangeFn onLocalChange);
  // Call on every loop(): ends presses, debounces local buttons.
  void tick();

  uint8_t count() const { return count_; }
  const OutputConfig& config(uint8_t i) const { return config_[i]; }
  int find(const char* id) const;  // index or -1
  bool isOn(uint8_t i) const { return on_[i]; }

  Result press(uint8_t i, bool longPress);
  Result set(uint8_t i, bool on);

 private:
  void drive(uint8_t i, bool on);

  const OutputConfig* config_ = nullptr;
  uint8_t count_ = 0;
  LocalChangeFn onLocalChange_ = nullptr;
  bool on_[MAX_OUTPUTS] = {};
  uint32_t releaseAt_[MAX_OUTPUTS] = {};  // button: millis() when the press ends, 0 = not pressed
  bool inputRaw_[MAX_OUTPUTS] = {};       // switch input: last reading (true = pressed)
  bool inputStable_[MAX_OUTPUTS] = {};    // switch input: debounced state
  uint32_t inputChangedAt_[MAX_OUTPUTS] = {};
};
