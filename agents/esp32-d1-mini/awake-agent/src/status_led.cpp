#include "status_led.h"

#include <Arduino.h>

#include "log.h"

namespace {

constexpr uint32_t ACTIVITY_MS = 150;

// Colour bits of an RGB LED; a single-colour LED is lit for anything but OFF.
enum Color : uint8_t { OFF = 0, RED = 1, GREEN = 2, BLUE = 4, YELLOW = RED | GREEN, UNSET = 0xFF };

StatusLedConfig leds[MAX_STATUS_LEDS];
uint8_t ledCount = 0;
uint8_t shown[MAX_STATUS_LEDS];  // colour last written, so pins are written only on a change
AgentStatus current = AgentStatus::NO_WIFI;
bool activityOn = false;
uint32_t activityUntil = 0;

bool isRgb(const StatusLedConfig& c) { return c.green != NO_PIN; }

Color pattern(AgentStatus status, uint32_t now) {
  switch (status) {
    case AgentStatus::NO_WIFI: return now % 2000 < 1000 ? RED : OFF;
    case AgentStatus::CONNECTING: {
      const uint32_t t = now % 2000;
      return t < 100 || (t >= 250 && t < 350) ? YELLOW : OFF;
    }
    case AgentStatus::ONLINE: return GREEN;
    case AgentStatus::STOPPED: return now % 3000 < 100 ? RED : OFF;
    case AgentStatus::CONFIG_ERROR: return now % 400 < 200 ? RED : OFF;
    case AgentStatus::SETUP: {
      const uint32_t t = now % 2000;
      return t < 100 || (t >= 250 && t < 350) || (t >= 500 && t < 600) ? BLUE : OFF;
    }
  }
  return OFF;
}

void writePin(int8_t pin, bool on, bool activeLow) { digitalWrite(pin, on != activeLow ? HIGH : LOW); }

void write(const StatusLedConfig& c, uint8_t color) {
  if (!isRgb(c)) return writePin(c.red, color != OFF, c.activeLow);
  writePin(c.red, color & RED, c.activeLow);
  writePin(c.green, color & GREEN, c.activeLow);
  writePin(c.blue, color & BLUE, c.activeLow);
}

// Pins of the LEDs before index `upTo` and of every output (and its local button).
bool pinTaken(int8_t pin, const StatusLedConfig* list, uint8_t upTo, const OutputConfig* outputs, uint8_t outputCount) {
  for (uint8_t i = 0; i < upTo; i++) {
    if (list[i].red == pin || list[i].green == pin || list[i].blue == pin) return true;
  }
  for (uint8_t i = 0; i < outputCount; i++) {
    if (outputs[i].pin == pin || outputs[i].inputPin == pin) return true;
  }
  return false;
}

}  // namespace

namespace statusLeds {

bool begin(const StatusLedConfig* list, uint8_t count, const OutputConfig* outputs, uint8_t outputCount) {
  ledCount = 0;
  if (count > MAX_STATUS_LEDS) {
    LOGE("led", "%u status LEDs, at most %u", count, MAX_STATUS_LEDS);
    return false;
  }
  for (uint8_t i = 0; i < count; i++) {
    const StatusLedConfig& c = list[i];
    const int8_t pins[3] = {c.red, c.green, c.blue};
    const uint8_t used = isRgb(c) ? 3 : 1;
    if (c.red < 0 || (c.green == NO_PIN) != (c.blue == NO_PIN)) {
      LOGE("led", "status LED %u: set its pin (or all three for RGB)", i + 1);
      return false;
    }
    for (uint8_t p = 0; p < used; p++) {
      bool repeated = false;
      for (uint8_t q = 0; q < p; q++) repeated = repeated || pins[q] == pins[p];
      if (pins[p] < 0 || repeated || pinTaken(pins[p], list, i, outputs, outputCount)) {
        LOGE("led", "status LED %u: pin %d is invalid or already used", i + 1, pins[p]);
        return false;
      }
    }
  }
  for (uint8_t i = 0; i < count; i++) {
    leds[i] = list[i];
    pinMode(leds[i].red, OUTPUT);
    if (isRgb(leds[i])) {
      pinMode(leds[i].green, OUTPUT);
      pinMode(leds[i].blue, OUTPUT);
    }
    shown[i] = UNSET;
  }
  ledCount = count;
  tick();
  return true;
}

void show(AgentStatus status) { current = status; }

void activity() {
  activityOn = true;
  activityUntil = millis() + ACTIVITY_MS;
}

void tick() {
  if (ledCount == 0) return;
  const uint32_t now = millis();
  if (activityOn && (int32_t)(now - activityUntil) >= 0) activityOn = false;
  const Color color = pattern(current, now);
  for (uint8_t i = 0; i < ledCount; i++) {
    const uint8_t c = activityOn ? (isRgb(leds[i]) ? BLUE : OFF) : color;
    if (c != shown[i]) {
      write(leds[i], c);
      shown[i] = c;
    }
  }
}

}  // namespace statusLeds
