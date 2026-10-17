#include "agent.h"

#include <ArduinoJson.h>
#include <WiFiNINA.h>

#include "backoff.h"
#include "log.h"
#include "net.h"
#include "version.h"
#include "watchdog.h"
#include "ws_client.h"

namespace {

constexpr int PROTOCOL_VERSION = 1;
constexpr uint32_t CONNECT_TIMEOUT_MS = 8000;  // TCP/TLS connect and HTTP upgrade, each
constexpr uint32_t WELCOME_TIMEOUT_MS = 10000;
constexpr uint32_t WIFI_TIMEOUT_MS = 15000;
constexpr uint32_t WIFI_RETRY_MS = 5000;
constexpr uint32_t WIFI_CHECK_MS = 1000;
constexpr uint32_t DEFAULT_HB_S = 20;

enum class State : uint8_t { WAITING, AWAITING_WELCOME, ONLINE, STOPPED };

AgentConfig cfg;
Outputs outputs;
WsClient ws;
WiFiClient plainClient;
WiFiSSLClient tlsClient;
Backoff backoff;

State state = State::WAITING;
uint32_t retryAt = 0;       // WAITING: when to connect again
uint32_t welcomeBy = 0;     // AWAITING_WELCOME: deadline
uint32_t hbMs = DEFAULT_HB_S * 1000;
uint32_t nextHbAt = 0;
uint32_t lastRxAt = 0;
uint32_t wifiCheckAt = 0;
uint32_t wifiRetryAt = 0;
bool wifiUp = false;
bool helloOn[MAX_OUTPUTS];  // switch states sent in the last hello
// hello "fw": our version plus the Wi-Fi module's firmware, which decides what the board can do (TLS
// roots, UDP broadcast) and is otherwise only visible in the boot log.
char firmware[65];

bool due(uint32_t at) { return (int32_t)(millis() - at) >= 0; }

bool send(const JsonDocument& doc) {
  char buf[2048];
  const size_t len = serializeJson(doc, buf, sizeof buf);
  if (len == 0 || len >= sizeof buf) {
    LOGE("agent", "message too large to send");
    return false;
  }
  return ws.sendText(buf, len);
}

void sendAck(const char* id, bool ok, const char* err = nullptr, int on = -1) {
  JsonDocument doc;
  doc["t"] = "ack";
  doc["id"] = id;
  doc["ok"] = ok;
  if (err) doc["err"] = err;
  if (on >= 0) doc["on"] = on == 1;
  send(doc);
}

void sendOutState(uint8_t i) {
  JsonDocument doc;
  doc["t"] = "out_state";
  doc["out"] = outputs.config(i).id;
  doc["on"] = outputs.isOn(i);
  send(doc);
}

void onLocalChange(uint8_t i, bool) {
  // Changes before the welcome are compared with the hello right after it; offline ones travel in the
  // next hello (PROTOCOL.md §5.1).
  if (state == State::ONLINE) sendOutState(i);
}

void scheduleRetry(uint16_t closeCode) {
  if (Backoff::isFatal(closeCode)) {
    LOGE("agent", "the server does not support protocol v%d (close 4004): update the firmware", PROTOCOL_VERSION);
    state = State::STOPPED;
    return;
  }
  const uint32_t delayMs = backoff.next(closeCode);
  LOGI("agent", "reconnecting in %lu ms", (unsigned long)delayMs);
  retryAt = millis() + delayMs;
  state = State::WAITING;
}

void onClosed(uint16_t code) {
  switch (code) {
    case 4000: LOGW("agent", "closed 4000: the server rejected a message (check the outputs in config.h)"); break;
    case 4001: LOGW("agent", "closed 4001: unknown token"); break;
    case 4002: LOGW("agent", "closed 4002: another agent connected with the same token"); break;
    case 4003: LOGW("agent", "closed 4003: token revoked or agent deleted"); break;
    case 4008: LOGW("agent", "closed 4008: hello too late"); break;
    case 4029: LOGW("agent", "closed 4029: too many failed attempts from this IP"); break;
    default: LOGW("agent", "disconnected (code %u)", code); break;
  }
  scheduleRetry(code);
}

void connectServer() {
  Client& client = cfg.tls ? static_cast<Client&>(tlsClient) : static_cast<Client&>(plainClient);
  LOGI("agent", "connecting to %s://%s:%u%s", cfg.tls ? "wss" : "ws", cfg.host, cfg.port, cfg.path);
  watchdogFeed();
  if (!ws.connect(client, cfg.host, cfg.port, cfg.path, CONNECT_TIMEOUT_MS)) {
    LOGW("agent", "connection failed");
    scheduleRetry(0);
    return;
  }
  watchdogFeed();

  JsonDocument doc;
  doc["t"] = "hello";
  doc["v"] = PROTOCOL_VERSION;
  doc["token"] = cfg.token;
  doc["fw"] = firmware;
  JsonArray list = doc["outputs"].to<JsonArray>();
  for (uint8_t i = 0; i < outputs.count(); i++) {
    const OutputConfig& c = outputs.config(i);
    JsonObject o = list.add<JsonObject>();
    o["id"] = c.id;
    if (c.mode == OUTPUT_MODE_BUTTON) {
      o["mode"] = "button";
      if (c.longMs) o["long"] = true;
    } else {
      o["mode"] = "switch";
      o["on"] = outputs.isOn(i);
    }
    helloOn[i] = outputs.isOn(i);
  }
  if (!send(doc)) {
    scheduleRetry(1006);
    return;
  }
  state = State::AWAITING_WELCOME;
  welcomeBy = millis() + WELCOME_TIMEOUT_MS;
  lastRxAt = millis();
}

void handleWelcome(JsonDocument& doc) {
  const char* t = doc["t"] | "";
  if (strcmp(t, "welcome") != 0 || (doc["v"] | 0) != PROTOCOL_VERSION) {
    LOGW("agent", "expected welcome v%d, got \"%s\"", PROTOCOL_VERSION, t);
    ws.close(1002);
    scheduleRetry(1002);
    return;
  }
  JsonVariant hb = doc["hb"];
  const long hbS = hb.is<long>() ? hb.as<long>() : 0;
  hbMs = (hbS > 0 && hbS <= 600 ? hbS : DEFAULT_HB_S) * 1000UL;
  state = State::ONLINE;
  backoff.reset();
  nextHbAt = millis() + hbMs;
  LOGI("agent", "connected as \"%s\", heartbeat %lu s", doc["name"] | "?", (unsigned long)(hbMs / 1000));

  for (uint8_t i = 0; i < outputs.count(); i++) {
    if (outputs.config(i).mode == OUTPUT_MODE_SWITCH && outputs.isOn(i) != helloOn[i]) sendOutState(i);
  }
}

void handleWake(const char* id, JsonDocument& doc) {
  uint8_t mac[6];
  if (!parseMac(doc["mac"] | "", mac)) return sendAck(id, false, "invalid");
  const bool sent = sendMagicPacket(mac, cfg.wolPort);
  LOGI("wol", "magic packet for %s %s", doc["mac"] | "", sent ? "sent" : "NOT sent");
  sendAck(id, sent, sent ? nullptr : "send failed");
}

void handleProbe(const char* id, JsonDocument& doc) {
  JsonDocument reply;
  reply["t"] = "probe_result";
  reply["id"] = id;

  IPAddress ip;
  JsonVariant portVar = doc["port"];
  long port = 0;
  bool valid = ip.fromString(doc["ip"] | "");
  if (!portVar.isNull()) {
    port = portVar.is<long>() ? portVar.as<long>() : 0;
    valid = valid && port >= 1 && port <= 65535;
  }
  if (!valid) {
    reply["up"] = false;
    reply["err"] = "invalid";
    send(reply);
    return;
  }
  long timeoutMs = doc["timeout"] | 2000L;
  if (timeoutMs < 100) timeoutMs = 100;
  if (timeoutMs > 10000) timeoutMs = 10000;  // the protocol allows 30 s, the watchdog does not

  watchdogFeed();
  const ProbeResult r = probe(ip, (uint16_t)port, (uint32_t)timeoutMs);
  watchdogFeed();
  reply["up"] = r.up;
  if (r.ms >= 0) reply["ms"] = r.ms;
  if (r.err) reply["err"] = r.err;
  send(reply);
}

void handleOutputCommand(const char* id, const char* t, JsonDocument& doc) {
  const int i = outputs.find(doc["out"] | "");
  if (i < 0) return sendAck(id, false, "unknown output");

  if (strcmp(t, "press") == 0) {
    switch (outputs.press(i, doc["long"] | false)) {
      case Outputs::OK: return sendAck(id, true);
      case Outputs::BUSY: return sendAck(id, false, "busy");
      case Outputs::NO_LONG_PRESS: return sendAck(id, false, "no long press");
      case Outputs::WRONG_MODE: return sendAck(id, false, "wrong mode");
    }
    return;
  }

  // set
  if (outputs.config(i).mode != OUTPUT_MODE_SWITCH) return sendAck(id, false, "wrong mode");
  if (!doc["on"].is<bool>()) return sendAck(id, false, "invalid", outputs.isOn(i));
  outputs.set(i, doc["on"].as<bool>());
  sendAck(id, true, nullptr, outputs.isOn(i));
}

void handleMessage(const char* text, size_t len) {
  lastRxAt = millis();
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, text, len);
  if (err) {
    LOGW("agent", "malformed message ignored (%s)", err.c_str());
    if (state == State::AWAITING_WELCOME) {
      ws.close(1002);
      scheduleRetry(1002);
    }
    return;
  }
  if (state == State::AWAITING_WELCOME) return handleWelcome(doc);

  const char* t = doc["t"] | "";
  if (strcmp(t, "hb") == 0) return;
  const char* id = doc["id"];
  if (!id) return;  // every command carries an id; without it there is nothing to answer
  if (strcmp(t, "wake") == 0) return handleWake(id, doc);
  if (strcmp(t, "probe") == 0) return handleProbe(id, doc);
  if (strcmp(t, "press") == 0 || strcmp(t, "set") == 0) return handleOutputCommand(id, t, doc);
  // Unknown types are ignored (forward compatibility, PROTOCOL.md §2).
}

// Keeps Wi-Fi associated. Returns whether it is up.
bool ensureWifi() {
  if (wifiUp && !due(wifiCheckAt)) return true;
  wifiCheckAt = millis() + WIFI_CHECK_MS;
  const bool up = WiFi.status() == WL_CONNECTED;
  if (up) {
    if (!wifiUp) {
      wifiUp = true;
      const IPAddress ip = WiFi.localIP();
      LOGI("wifi", "connected to \"%s\", ip %u.%u.%u.%u, rssi %ld dBm", cfg.wifiSsid, ip[0], ip[1], ip[2], ip[3], WiFi.RSSI());
      // Network back: reconnect now rather than after the backoff (PROTOCOL.md §8).
      if (state == State::WAITING) retryAt = millis();
    }
    return true;
  }

  if (wifiUp) {
    wifiUp = false;
    LOGW("wifi", "connection lost");
    if (ws.isOpen()) ws.close(1001);
    if (state == State::AWAITING_WELCOME || state == State::ONLINE) state = State::WAITING;
  }
  if (!due(wifiRetryAt)) return false;
  LOGI("wifi", "connecting to \"%s\"", cfg.wifiSsid);
  WiFi.begin(cfg.wifiSsid, cfg.wifiPassword);  // blocks up to WIFI_TIMEOUT_MS, feeding the watchdog
  wifiRetryAt = millis() + WIFI_RETRY_MS;
  wifiCheckAt = millis();
  return false;
}

}  // namespace

bool Agent::begin(const AgentConfig& config, const OutputConfig* outputList, uint8_t outputCount) {
  cfg = config;
  LOGI("agent", "%s starting", AWAKE_FIRMWARE);
  if (!outputs.begin(outputList, outputCount, onLocalChange)) {
    LOGE("agent", "invalid outputs in config.h: not connecting");
    return false;
  }
  if (!cfg.token || strncmp(cfg.token, "awk_", 4) != 0) {
    LOGE("agent", "AWAKE_TOKEN is not set in config.h: not connecting");
    return false;
  }
  if (WiFi.status() == WL_NO_MODULE) {
    LOGE("wifi", "Wi-Fi module not responding");
    return false;
  }
  const String fw = WiFi.firmwareVersion();
  snprintf(firmware, sizeof firmware, "%s nina/%s", AWAKE_FIRMWARE, fw.c_str());
  if (fw < WIFI_FIRMWARE_LATEST_VERSION) {
    LOGW("wifi", "Wi-Fi module firmware %s, latest %s: update it (see README)", fw.c_str(), WIFI_FIRMWARE_LATEST_VERSION);
  }

  // The SAMD21 has no hardware RNG: mix floating analog inputs, timing and the MAC for backoff jitter
  // and WebSocket masks (neither needs cryptographic randomness).
  uint8_t mac[6];
  WiFi.macAddress(mac);
  uint32_t seed = micros();
  for (int pin = A0; pin <= A6; pin++) seed = seed * 31 + analogRead(pin);
  for (uint8_t b : mac) seed = seed * 31 + b;
  randomSeed(seed);

  WiFi.setFeedWatchdogFunc(watchdogFeed);
  WiFi.setTimeout(WIFI_TIMEOUT_MS);
  WiFi.noLowPowerMode();  // commands are answered promptly; the board is mains powered anyway
  plainClient.setConnectionTimeout(CONNECT_TIMEOUT_MS);
  tlsClient.setConnectionTimeout(CONNECT_TIMEOUT_MS);

  state = State::WAITING;
  retryAt = millis();
  return true;
}

void Agent::loop() {
  outputs.tick();
  if (state == State::STOPPED) return;
  if (!ensureWifi()) return;

  switch (state) {
    case State::WAITING:
      if (due(retryAt)) connectServer();
      return;

    case State::AWAITING_WELCOME:
    case State::ONLINE: {
      // A failed send (here, in a handler or in onLocalChange) drops the connection: notice it.
      if (!ws.isOpen()) return onClosed(ws.closeCode());
      const WsClient::Event ev = ws.poll();
      if (ev == WsClient::CLOSED) return onClosed(ws.closeCode());
      if (ev == WsClient::TEXT) handleMessage(ws.text(), ws.textLength());
      if (state != State::ONLINE && state != State::AWAITING_WELCOME) return;  // a handler scheduled a retry
      if (!ws.isOpen()) return onClosed(ws.closeCode());

      if (state == State::AWAITING_WELCOME) {
        if (due(welcomeBy)) {
          LOGW("agent", "no welcome within %lu s", (unsigned long)(WELCOME_TIMEOUT_MS / 1000));
          ws.close(1002);
          scheduleRetry(1002);
        }
        return;
      }
      if (millis() - lastRxAt > 3 * hbMs) {
        // Half-open connections are common after Wi-Fi drops (PROTOCOL.md §6).
        LOGW("agent", "nothing received for %lu s", (unsigned long)(3 * hbMs / 1000));
        ws.close(1001);
        return onClosed(1006);
      }
      if (due(nextHbAt)) {
        nextHbAt = millis() + hbMs;
        JsonDocument hb;
        hb["t"] = "hb";
        if (!send(hb)) return onClosed(ws.closeCode());
      }
      return;
    }

    case State::STOPPED:
      return;
  }
}
