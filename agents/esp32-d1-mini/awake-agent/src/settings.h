#pragma once

#include <ArduinoJson.h>
#include <stdint.h>

#include "outputs.h"

// The agent's configuration, entered on the setup page (portal.cpp) and kept in NVS (flash) as one JSON
// document, so the same firmware file works for everyone: nothing is compiled in.
//
//   { "v": 1, "ssid": "…", "pass": "…", "server": "wss://awake.example.com/agent", "token": "awk_…",
//     "wol": 9, "led": 2, "ledLow": false,
//     "outputs": [ { "id": "pc-power", "mode": "button", "pin": 16, "low": true, "short": 300, "long": 5000 },
//                  { "id": "lamp", "mode": "switch", "pin": 17, "low": true, "input": 18, "initial": false } ] }
//
// Pins are GPIO numbers (as printed on the board: IO16…). Only pins that are safe for a relay are
// accepted (see allowedPin): no flash pins (6–11), no input-only pins (34–39), no GPIO0/12 (boot straps).

constexpr uint8_t MAX_ESP_OUTPUTS = 16;

struct ServerUrl {
  bool tls;
  char host[100];
  uint16_t port;
  char path[64];
};

struct Settings {
  char ssid[33];
  char pass[65];
  char server[160];
  char token[80];
  ServerUrl url;  // parsed from `server`
  uint16_t wolPort;
  int8_t ledPin;  // NO_PIN for none
  bool ledActiveLow;
  OutputConfig outputs[MAX_ESP_OUTPUTS];  // ids point into outputIds
  char outputIds[MAX_ESP_OUTPUTS][33];
  uint8_t outputCount;
};

namespace settings {

// Validates a configuration document and fills `out`. Null when valid, else an English message for the
// setup page (which field is wrong). `keep` provides the Wi-Fi password and token when the document
// leaves them empty (editing an existing configuration without retyping secrets).
const char* fromJson(JsonVariantConst doc, Settings& out, const Settings* keep);

// The saved configuration; false when there is none or it is no longer valid.
bool load(Settings& out);
// Saves a configuration that passed fromJson (secrets included).
bool save(const Settings& s);
void clear();

// For the setup page: the configuration without the Wi-Fi password and the token.
void toJson(const Settings& s, JsonObject out);

bool allowedPin(int pin);

}  // namespace settings
