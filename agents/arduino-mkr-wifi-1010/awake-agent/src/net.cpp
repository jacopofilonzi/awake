#include "net.h"

#include <WiFiNINA.h>
#include <WiFiUdp.h>

#include "log.h"

namespace {

// Send-only. The Wi-Fi module rejects broadcasts on a UDP socket opened implicitly by beginPacket(), so
// it is opened with begin() on a high local port: nothing is ever read from it, and no Wake-on-LAN
// broadcast (port 7/9) lands there.
WiFiUDP udp;
constexpr uint16_t UDP_LOCAL_PORT = 40009;
bool udpOpen = false;

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

bool sendTo(const IPAddress& ip, uint16_t port, const uint8_t* packet, size_t len) {
  if (!udpOpen) {
    udpOpen = udp.begin(UDP_LOCAL_PORT);
    if (!udpOpen) {
      LOGW("wol", "no UDP socket available");
      return false;
    }
  }
  if (!udp.beginPacket(ip, port)) return false;
  udp.write(packet, len);
  return udp.endPacket();
}

}  // namespace

bool parseMac(const char* text, uint8_t mac[6]) {
  if (!text || strlen(text) != 17) return false;
  for (int i = 0; i < 6; i++) {
    const int hi = hexDigit(text[i * 3]);
    const int lo = hexDigit(text[i * 3 + 1]);
    if (hi < 0 || lo < 0) return false;
    if (i < 5 && text[i * 3 + 2] != ':') return false;
    mac[i] = (hi << 4) | lo;
  }
  return true;
}

bool sendMagicPacket(const uint8_t mac[6], uint16_t port) {
  uint8_t packet[102];
  memset(packet, 0xff, 6);
  for (int i = 0; i < 16; i++) memcpy(packet + 6 + i * 6, mac, 6);

  const bool limited = sendTo(IPAddress(255, 255, 255, 255), port, packet, sizeof packet);

  // Directed broadcast (ip | ~netmask): some stacks or access points drop the limited one.
  const IPAddress ip = WiFi.localIP();
  const IPAddress mask = WiFi.subnetMask();
  const IPAddress directed(ip[0] | ~mask[0], ip[1] | ~mask[1], ip[2] | ~mask[2], ip[3] | ~mask[3]);
  const bool subnet = sendTo(directed, port, packet, sizeof packet);

  if (!limited || !subnet) LOGW("wol", "broadcast failed: limited=%d subnet=%d", limited, subnet);
  return limited || subnet;
}

ProbeResult probe(const IPAddress& ip, uint16_t port, uint32_t timeoutMs) {
  const uint32_t start = millis();
  if (port == 0) {
    const int rtt = WiFi.ping(ip);
    LOGI("probe", "ping %u.%u.%u.%u: %d (%lu ms)", ip[0], ip[1], ip[2], ip[3], rtt, (unsigned long)(millis() - start));
    if (rtt >= 0) return {(uint32_t)rtt <= timeoutMs, rtt, nullptr};
    if (rtt == WL_PING_TIMEOUT || rtt == WL_PING_DEST_UNREACHABLE) return {false, -1, nullptr};
    return {false, -1, "probe failed"};
  }

  // The Wi-Fi module reports a refused connection (TCP RST, host up) and a timeout the same way. A
  // refusal arrives within milliseconds on a LAN, a dead host only fails at the timeout: a failure much
  // earlier than the timeout counts as "refused", hence up.
  WiFiClient client;
  client.setConnectionTimeout(timeoutMs);
  const bool connected = client.connect(ip, port);
  const uint32_t elapsed = millis() - start;
  client.stop();
  LOGI("probe", "tcp %u.%u.%u.%u:%u: %s after %lu ms", ip[0], ip[1], ip[2], ip[3], port, connected ? "connected" : "failed", (unsigned long)elapsed);
  if (connected) return {true, (int32_t)elapsed, nullptr};
  const uint32_t refusedWithin = timeoutMs / 2 < 500 ? timeoutMs / 2 : 500;
  return {elapsed < refusedWithin, elapsed < refusedWithin ? (int32_t)elapsed : -1, nullptr};
}
