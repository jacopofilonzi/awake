#include "outputs.h"

#include <Arduino.h>
#include <string.h>

#include "log.h"

namespace {

constexpr uint32_t DEBOUNCE_MS = 50;

bool validId(const char* id) {
  if (!id) return false;
  const size_t len = strlen(id);
  if (len < 1 || len > 32) return false;
  for (size_t i = 0; i < len; i++) {
    const char c = id[i];
    const bool alnum = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    if (!alnum && (i == 0 || (c != '-' && c != '_'))) return false;
  }
  return true;
}

}  // namespace

bool Outputs::begin(const OutputConfig* config, uint8_t count, LocalChangeFn onLocalChange) {
  if (count > MAX_OUTPUTS) {
    LOGE("outputs", "%u outputs configured, at most %u", count, MAX_OUTPUTS);
    return false;
  }
  bool ok = true;
  for (uint8_t i = 0; i < count; i++) {
    const OutputConfig& c = config[i];
    if (!validId(c.id)) {
      LOGE("outputs", "output %u: invalid id \"%s\" (1-32 chars of a-z 0-9 - _)", i, c.id ? c.id : "");
      ok = false;
      continue;
    }
    for (uint8_t j = 0; j < i; j++) {
      if (strcmp(config[j].id, c.id) == 0) {
        LOGE("outputs", "duplicate output id \"%s\"", c.id);
        ok = false;
      }
    }
    if (c.pin < 0) {
      LOGE("outputs", "%s: no pin", c.id);
      ok = false;
    }
    if (c.mode == OUTPUT_MODE_BUTTON && c.shortMs == 0) {
      LOGE("outputs", "%s: a button needs a short press duration", c.id);
      ok = false;
    }
  }
  if (!ok) return false;

  config_ = config;
  count_ = count;
  onLocalChange_ = onLocalChange;
  for (uint8_t i = 0; i < count; i++) {
    const OutputConfig& c = config[i];
    on_[i] = c.mode == OUTPUT_MODE_SWITCH && c.initialOn;
    drive(i, on_[i]);  // set the level before switching the pin to output: no glitch on the relay
    pinMode(c.pin, OUTPUT);
    drive(i, on_[i]);
    if (c.mode == OUTPUT_MODE_SWITCH && c.inputPin >= 0) pinMode(c.inputPin, INPUT_PULLUP);
    LOGI("outputs", "%s: %s on pin %d%s", c.id, c.mode == OUTPUT_MODE_BUTTON ? "button" : "switch", c.pin,
         c.activeLow ? " (active low)" : "");
  }
  return true;
}

void Outputs::tick() {
  const uint32_t now = millis();
  for (uint8_t i = 0; i < count_; i++) {
    const OutputConfig& c = config_[i];
    if (c.mode == OUTPUT_MODE_BUTTON) {
      if (releaseAt_[i] && (int32_t)(now - releaseAt_[i]) >= 0) {
        releaseAt_[i] = 0;
        drive(i, false);
        LOGI("outputs", "%s released", c.id);
      }
      continue;
    }
    if (c.inputPin < 0) continue;
    const bool pressed = digitalRead(c.inputPin) == LOW;
    if (pressed != inputRaw_[i]) {
      inputRaw_[i] = pressed;
      inputChangedAt_[i] = now;
    } else if (pressed != inputStable_[i] && now - inputChangedAt_[i] >= DEBOUNCE_MS) {
      inputStable_[i] = pressed;
      if (pressed) {  // toggle on press, not on release
        on_[i] = !on_[i];
        drive(i, on_[i]);
        LOGI("outputs", "%s %s (local button)", c.id, on_[i] ? "on" : "off");
        if (onLocalChange_) onLocalChange_(i, on_[i]);
      }
    }
  }
}

int Outputs::find(const char* id) const {
  for (uint8_t i = 0; i < count_; i++) {
    if (strcmp(config_[i].id, id) == 0) return i;
  }
  return -1;
}

Outputs::Result Outputs::press(uint8_t i, bool longPress) {
  const OutputConfig& c = config_[i];
  if (c.mode != OUTPUT_MODE_BUTTON) return WRONG_MODE;
  if (longPress && c.longMs == 0) return NO_LONG_PRESS;
  if (releaseAt_[i]) return BUSY;
  const uint16_t ms = longPress ? c.longMs : c.shortMs;
  releaseAt_[i] = millis() + ms;
  if (releaseAt_[i] == 0) releaseAt_[i] = 1;  // 0 means "not pressed"
  drive(i, true);
  LOGI("outputs", "%s pressed (%s, %u ms)", c.id, longPress ? "long" : "short", ms);
  return OK;
}

Outputs::Result Outputs::set(uint8_t i, bool on) {
  const OutputConfig& c = config_[i];
  if (c.mode != OUTPUT_MODE_SWITCH) return WRONG_MODE;
  if (on_[i] != on) {
    on_[i] = on;
    drive(i, on);
    LOGI("outputs", "%s %s", c.id, on ? "on" : "off");
  }
  return OK;
}

void Outputs::drive(uint8_t i, bool on) {
  const OutputConfig& c = config_[i];
  digitalWrite(c.pin, (on != c.activeLow) ? HIGH : LOW);
}
