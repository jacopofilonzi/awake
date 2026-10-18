#pragma once

#include "settings.h"

// The Awake agent protocol v1 (docs/PROTOCOL.md) on an ESP32 D1 mini: Wi-Fi, the WebSocket connection to
// the server (hello/welcome, heartbeats, 3×hb silence detection, backoff honouring the close codes), the
// commands (wake, probe, press, set), out_state for switches changed by their local button, and info
// every 5 minutes.
//
// Everything runs from loop(). Blocking calls (the TLS handshake, a probe) are bounded by timeouts below
// the 30 s watchdog. Commands are not queued: one received on a connection that then drops is lost (§4).

class Agent {
 public:
  // False when the configuration can't be used (the reason is logged): the agent then does nothing.
  bool begin(const Settings& settings);
  void loop();
};
