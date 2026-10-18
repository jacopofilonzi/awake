#include "net.h"

#include <NetworkClient.h>
#include <NetworkUdp.h>
#include <WiFi.h>
#include <freertos/semphr.h>
#include <lwip/ip_addr.h>
#include <ping/ping_sock.h>

#include "log.h"

namespace {

NetworkUDP udp;  // send-only: never read, so nothing listens on the LAN

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool sendTo(const IPAddress& ip, uint16_t port, const uint8_t* packet, size_t len) {
  if (!udp.beginPacket(ip, port)) return false;
  udp.write(packet, len);
  return udp.endPacket();
}

// ICMP through the ESP-IDF ping session API: one echo, the result collected by its callbacks.
struct PingResult {
  SemaphoreHandle_t done;
  bool up;
  uint32_t ms;
};

void onPingSuccess(esp_ping_handle_t handle, void* arg) {
  PingResult* r = static_cast<PingResult*>(arg);
  uint32_t elapsed = 0;
  esp_ping_get_profile(handle, ESP_PING_PROF_TIMEGAP, &elapsed, sizeof elapsed);
  r->up = true;
  r->ms = elapsed;
}

void onPingEnd(esp_ping_handle_t, void* arg) { xSemaphoreGive(static_cast<PingResult*>(arg)->done); }

ProbeResult ping(const IPAddress& ip, uint32_t timeoutMs) {
  PingResult result = {xSemaphoreCreateBinary(), false, 0};
  if (!result.done) return {false, -1, "probe failed"};

  esp_ping_config_t config = ESP_PING_DEFAULT_CONFIG();
  IP_ADDR4(&config.target_addr, ip[0], ip[1], ip[2], ip[3]);
  config.count = 1;
  config.timeout_ms = timeoutMs;
  config.interval_ms = 100;
  esp_ping_callbacks_t callbacks = {};
  callbacks.cb_args = &result;
  callbacks.on_ping_success = onPingSuccess;
  callbacks.on_ping_end = onPingEnd;

  esp_ping_handle_t session = nullptr;
  if (esp_ping_new_session(&config, &callbacks, &session) != ESP_OK) {
    vSemaphoreDelete(result.done);
    return {false, -1, "probe failed"};
  }
  esp_ping_start(session);
  const bool ended = xSemaphoreTake(result.done, pdMS_TO_TICKS(timeoutMs + 1000)) == pdTRUE;
  esp_ping_stop(session);
  esp_ping_delete_session(session);
  vSemaphoreDelete(result.done);
  if (!ended) return {false, -1, "probe failed"};
  LOGI("probe", "ping %u.%u.%u.%u: %s", ip[0], ip[1], ip[2], ip[3], result.up ? "reply" : "no reply");
  return {result.up, result.up ? (int32_t)result.ms : -1, nullptr};
}

}  // namespace

bool parseMac(const char* text, uint8_t mac[6]) {
  if (strlen(text) != 17) return false;
  for (int i = 0; i < 6; i++) {
    const int hi = hexDigit(text[i * 3]);
    const int lo = hexDigit(text[i * 3 + 1]);
    if (hi < 0 || lo < 0) return false;
    if (i < 5 && text[i * 3 + 2] != ':') return false;
    mac[i] = (uint8_t)(hi << 4 | lo);
  }
  return true;
}

bool sendMagicPacket(const uint8_t mac[6], uint16_t port) {
  uint8_t packet[102];
  memset(packet, 0xff, 6);
  for (int i = 0; i < 16; i++) memcpy(packet + 6 + i * 6, mac, 6);

  const bool limited = sendTo(IPAddress(255, 255, 255, 255), port, packet, sizeof packet);
  const IPAddress ip = WiFi.localIP();
  const IPAddress mask = WiFi.subnetMask();
  IPAddress directed;
  for (int i = 0; i < 4; i++) directed[i] = ip[i] | ~mask[i];
  const bool subnet = sendTo(directed, port, packet, sizeof packet);
  return limited || subnet;
}

ProbeResult probe(const IPAddress& ip, uint16_t port, uint32_t timeoutMs) {
  if (port == 0) return ping(ip, timeoutMs);

  // TCP: connected, or refused (an RST proves the host is up). The client does not tell refused from
  // timeout, but a refusal comes back within milliseconds on a LAN while a dead host takes the timeout.
  NetworkClient client;
  const uint32_t start = millis();
  const bool connected = client.connect(ip, port, timeoutMs);
  const uint32_t elapsed = millis() - start;
  client.stop();
  LOGI("probe", "tcp %u.%u.%u.%u:%u: %s after %lu ms", ip[0], ip[1], ip[2], ip[3], port, connected ? "connected" : "failed",
       (unsigned long)elapsed);
  if (connected) return {true, (int32_t)elapsed, nullptr};
  const uint32_t refusedWithin = timeoutMs / 2 < 500 ? timeoutMs / 2 : 500;
  return {elapsed < refusedWithin, elapsed < refusedWithin ? (int32_t)elapsed : -1, nullptr};
}
