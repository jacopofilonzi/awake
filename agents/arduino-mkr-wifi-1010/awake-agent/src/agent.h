#pragma once

#include <stdint.h>

#include "outputs.h"

// The Awake agent protocol v1 (docs/PROTOCOL.md) on the MKR WiFi 1010: Wi-Fi, the WebSocket connection
// to the server (hello/welcome, heartbeats, 3×hb silence detection, backoff honouring the close codes),
// the commands (wake, probe, press, set) and out_state for switches changed by their local button.
//
// Everything runs from loop() without blocking for long: the only blocking calls are the Wi-Fi
// association, the TCP/TLS connect and a probe, each bounded by a timeout below the 16 s watchdog.
// Commands are not queued: one received on a connection that then drops is lost (§4).

struct AgentConfig {
  const char* wifiSsid;
  const char* wifiPassword;
  const char* host;   // server name or IP
  uint16_t port;
  bool tls;           // wss:// (certificate validated by the Wi-Fi module)
  const char* path;   // "/agent"
  const char* token;  // never logged
  uint16_t wolPort;   // 9 (or 7)
};

class Agent {
 public:
  // False when the configuration is invalid (the reason is logged): the agent then does nothing.
  bool begin(const AgentConfig& config, const OutputConfig* outputs, uint8_t outputCount);
  void loop();
};
