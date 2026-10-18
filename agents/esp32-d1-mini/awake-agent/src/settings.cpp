#include "settings.h"

#include <Preferences.h>
#include <string.h>

#include "log.h"

namespace {

constexpr const char* NVS_NAMESPACE = "awake";
constexpr const char* NVS_KEY = "config";

// Safe for an output or a local button: not a flash pin, not input-only, not a strapping pin that would
// change how the chip boots if a relay module pulls it (GPIO0, GPIO12). GPIO2 is the on-board LED.
constexpr int ALLOWED_PINS[] = {2, 4, 5, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};

bool copy(char* dst, size_t size, const char* src) {
  if (!src) src = "";
  const size_t len = strlen(src);
  if (len >= size) return false;
  memcpy(dst, src, len + 1);
  return true;
}

// "wss://host[:port][/path]" or "ws://…"; default port 443/80, default path /agent.
bool parseServer(const char* text, ServerUrl& url) {
  const char* rest;
  if (strncmp(text, "wss://", 6) == 0) {
    url.tls = true;
    rest = text + 6;
  } else if (strncmp(text, "ws://", 5) == 0) {
    url.tls = false;
    rest = text + 5;
  } else {
    return false;
  }
  const char* slash = strchr(rest, '/');
  const size_t hostPortLen = slash ? (size_t)(slash - rest) : strlen(rest);
  char hostPort[sizeof url.host + 6];
  if (hostPortLen == 0 || hostPortLen >= sizeof hostPort) return false;
  memcpy(hostPort, rest, hostPortLen);
  hostPort[hostPortLen] = '\0';

  url.port = url.tls ? 443 : 80;
  char* colon = strrchr(hostPort, ':');
  if (colon) {
    *colon = '\0';
    char* end;
    const long port = strtol(colon + 1, &end, 10);
    if (*end != '\0' || port < 1 || port > 65535) return false;
    url.port = (uint16_t)port;
  }
  if (hostPort[0] == '\0' || !copy(url.host, sizeof url.host, hostPort)) return false;
  return copy(url.path, sizeof url.path, slash && slash[1] ? slash : "/agent");
}

bool validId(const char* id) {
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

namespace settings {

bool allowedPin(int pin) {
  for (int p : ALLOWED_PINS) {
    if (p == pin) return true;
  }
  return false;
}

const char* fromJson(JsonVariantConst doc, Settings& s, const Settings* keep) {
  memset(&s, 0, sizeof s);
  if (!copy(s.ssid, sizeof s.ssid, doc["ssid"] | "") || s.ssid[0] == '\0') return "Wi-Fi network: required, at most 32 characters";

  const char* pass = doc["pass"] | "";
  if (pass[0] == '\0' && keep && strcmp(keep->ssid, s.ssid) == 0) pass = keep->pass;  // unchanged
  if (!copy(s.pass, sizeof s.pass, pass)) return "Wi-Fi password: at most 64 characters";
  if (s.pass[0] != '\0' && strlen(s.pass) < 8) return "Wi-Fi password: at least 8 characters (or empty for an open network)";

  if (!copy(s.server, sizeof s.server, doc["server"] | "") || !parseServer(s.server, s.url)) {
    return "Server: an address like wss://awake.example.com/agent";
  }

  const char* token = doc["token"] | "";
  if (token[0] == '\0' && keep) token = keep->token;  // unchanged
  if (!copy(s.token, sizeof s.token, token) || strncmp(s.token, "awk_", 4) != 0 || strlen(s.token) < 20) {
    return "Token: the one shown when the agent was created (it starts with awk_)";
  }

  const long wol = doc["wol"] | 9L;
  if (wol < 1 || wol > 65535) return "Wake-on-LAN port: 1-65535 (usually 9)";
  s.wolPort = (uint16_t)wol;

  const long led = doc["led"] | -1L;
  if (led != -1 && !allowedPin(led)) return "Status LED: a usable GPIO (2 is the board's LED) or none";
  s.ledPin = (int8_t)led;
  s.ledActiveLow = doc["ledLow"] | false;

  JsonArrayConst outputs = doc["outputs"].as<JsonArrayConst>();
  if (outputs.size() > MAX_ESP_OUTPUTS) return "Outputs: at most 16";
  int usedPins[1 + 2 * MAX_ESP_OUTPUTS];
  size_t used = 0;
  if (s.ledPin >= 0) usedPins[used++] = s.ledPin;
  auto take = [&](int pin) {
    for (size_t i = 0; i < used; i++) {
      if (usedPins[i] == pin) return false;
    }
    usedPins[used++] = pin;
    return true;
  };

  static char msg[96];
  for (JsonObjectConst o : outputs) {
    const uint8_t i = s.outputCount;
    OutputConfig& c = s.outputs[i];
    if (!copy(s.outputIds[i], sizeof s.outputIds[i], o["id"] | "") || !validId(s.outputIds[i])) {
      snprintf(msg, sizeof msg, "Output %u: name of 1-32 characters a-z 0-9 - _ (lowercase)", i + 1);
      return msg;
    }
    for (uint8_t j = 0; j < i; j++) {
      if (strcmp(s.outputIds[j], s.outputIds[i]) == 0) {
        snprintf(msg, sizeof msg, "Output \"%s\": the name is used twice", s.outputIds[i]);
        return msg;
      }
    }
    c.id = s.outputIds[i];
    const char* mode = o["mode"] | "";
    c.mode = strcmp(mode, "switch") == 0 ? OUTPUT_MODE_SWITCH : OUTPUT_MODE_BUTTON;
    if (strcmp(mode, "button") != 0 && strcmp(mode, "switch") != 0) {
      snprintf(msg, sizeof msg, "Output \"%s\": type must be button or switch", c.id);
      return msg;
    }
    const long pin = o["pin"] | -1L;
    if (!allowedPin(pin) || !take(pin)) {
      snprintf(msg, sizeof msg, "Output \"%s\": GPIO %ld is not usable or already used", c.id, pin);
      return msg;
    }
    c.pin = (int8_t)pin;
    c.activeLow = o["low"] | false;
    c.inputPin = NO_PIN;
    if (c.mode == OUTPUT_MODE_BUTTON) {
      const long shortMs = o["short"] | 300L;
      const long longMs = o["long"] | 0L;
      if (shortMs < 50 || shortMs > 10000 || longMs < 0 || longMs > 20000 || (longMs && longMs <= shortMs)) {
        snprintf(msg, sizeof msg, "Output \"%s\": press 50-10000 ms, long press 0 or longer than the press (max 20000)", c.id);
        return msg;
      }
      c.shortMs = (uint16_t)shortMs;
      c.longMs = (uint16_t)longMs;
    } else {
      const long input = o["input"] | -1L;
      if (input != -1) {
        if (!allowedPin(input) || !take(input)) {
          snprintf(msg, sizeof msg, "Output \"%s\": button GPIO %ld is not usable or already used", c.id, input);
          return msg;
        }
        c.inputPin = (int8_t)input;
      }
      c.initialOn = o["initial"] | false;
    }
    s.outputCount++;
  }
  return nullptr;
}

bool load(Settings& out) {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, true)) return false;  // namespace missing: never configured
  const String text = prefs.getString(NVS_KEY, "");
  prefs.end();
  if (text.isEmpty()) return false;
  JsonDocument doc;
  if (deserializeJson(doc, text)) {
    LOGE("settings", "saved configuration is not valid JSON");
    return false;
  }
  const char* err = fromJson(doc.as<JsonVariantConst>(), out, nullptr);
  if (err) {
    LOGE("settings", "saved configuration is invalid: %s", err);
    return false;
  }
  return true;
}

bool save(const Settings& s) {
  JsonDocument doc;
  JsonObject o = doc.to<JsonObject>();
  toJson(s, o);
  o["pass"] = s.pass;
  o["token"] = s.token;
  String text;
  serializeJson(doc, text);
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, false)) return false;
  const bool ok = prefs.putString(NVS_KEY, text) == text.length();
  prefs.end();
  return ok;
}

void clear() {
  Preferences prefs;
  if (prefs.begin(NVS_NAMESPACE, false)) {
    prefs.clear();
    prefs.end();
  }
}

void toJson(const Settings& s, JsonObject o) {
  o["v"] = 1;
  o["ssid"] = s.ssid;
  o["server"] = s.server;
  o["wol"] = s.wolPort;
  o["led"] = s.ledPin;
  o["ledLow"] = s.ledActiveLow;
  JsonArray list = o["outputs"].to<JsonArray>();
  for (uint8_t i = 0; i < s.outputCount; i++) {
    const OutputConfig& c = s.outputs[i];
    JsonObject x = list.add<JsonObject>();
    x["id"] = c.id;
    x["mode"] = c.mode == OUTPUT_MODE_SWITCH ? "switch" : "button";
    x["pin"] = c.pin;
    x["low"] = c.activeLow;
    if (c.mode == OUTPUT_MODE_BUTTON) {
      x["short"] = c.shortMs;
      x["long"] = c.longMs;
    } else {
      x["input"] = c.inputPin;
      x["initial"] = c.initialOn;
    }
  }
}

}  // namespace settings
