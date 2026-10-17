// Awake agent for the Arduino MKR WiFi 1010: Wake-on-LAN, reachability probes and relay outputs,
// driven by an Awake server over an outbound WebSocket. Protocol: docs/PROTOCOL.md (v1).
// Configuration: config.h (copy config.example.h). Code: src/ (agent.cpp is the protocol).

#if __has_include("config.h")
#include "config.h"
#else
#error "config.h is missing: copy config.example.h to config.h and fill it in (or run make config)"
#endif

#include "src/agent.h"
#include "src/status_led.h"
#include "src/watchdog.h"

Agent agent;

void setup() {
  Serial.begin(115200);
  // Leave a moment to open the serial monitor after a reset; the agent runs without one too.
  const uint32_t start = millis();
  while (!Serial && millis() - start < 2000) {
  }
  watchdogEnable();

  const AgentConfig config = {WIFI_SSID, WIFI_PASSWORD, AWAKE_HOST, AWAKE_PORT, AWAKE_TLS, AWAKE_PATH, AWAKE_TOKEN, WOL_PORT};
  if (!agent.begin(config, OUTPUTS, sizeof OUTPUTS / sizeof OUTPUTS[0], STATUS_LEDS, sizeof STATUS_LEDS / sizeof STATUS_LEDS[0])) {
    // Configuration error (logged): keep the board alive and blink, so it is visible without a monitor.
    statusLeds::show(AgentStatus::CONFIG_ERROR);
    for (;;) {
      watchdogFeed();
      statusLeds::tick();
    }
  }
}

void loop() {
  watchdogFeed();
  agent.loop();
}
