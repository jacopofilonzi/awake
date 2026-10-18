// Awake agent for the ESP32 D1 mini (ESP32-WROOM-32): Wake-on-LAN, reachability probes and relay
// outputs, driven by an Awake server over an outbound WebSocket. Protocol: docs/PROTOCOL.md (v1).
//
// Nothing is configured at compile time: the same firmware file works for everyone. Wi-Fi, server, token
// and outputs are entered on the board's setup page (src/portal.cpp) and kept in flash (src/settings.cpp).
// Setup mode starts when there is no valid configuration, when the reset button is pressed twice within
// a few seconds, or when the BOOT button (GPIO0, if the board has one) is held while the board starts.

#include <Preferences.h>

#include "src/agent.h"
#include "src/log.h"
#include "src/portal.h"
#include "src/settings.h"
#include "src/status_led.h"
#include "src/version.h"
#include "src/sysinfo.h"
#include "src/watchdog.h"

namespace {

constexpr int BOOT_BUTTON_PIN = 0;
constexpr uint32_t QUICK_RESTART_WINDOW_MS = 5000;

Settings config;
Agent agent;
StatusLedConfig led;
bool quickRestartArmed = false;

// Two starts in a row, each ending within the window, ask for the setup: a counter in NVS survives the
// reset (RTC memory does not: the D1 mini's reset button drives the chip's EN pin, a full power-on reset).
bool setupRequestedByRestarts() {
  Preferences prefs;
  if (!prefs.begin("awake-boot", false)) return false;
  const uint8_t quick = prefs.getUChar("quick", 0) + 1;
  prefs.putUChar("quick", quick >= 2 ? 0 : quick);
  prefs.end();
  return quick >= 2;
}

void disarmQuickRestart() {
  Preferences prefs;
  if (prefs.begin("awake-boot", false)) {
    prefs.putUChar("quick", 0);
    prefs.end();
  }
}

bool bootButtonHeld() {
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  delay(20);
  return digitalRead(BOOT_BUTTON_PIN) == LOW;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);  // let a serial monitor attach after a reset
  LOGI("agent", "%s starting, last reset: %s", AWAKE_FIRMWARE, sysinfo::resetReason());
  watchdogEnable();

  const bool haveConfig = settings::load(config);
  const bool requested = setupRequestedByRestarts() || bootButtonHeld();
  quickRestartArmed = true;

  led = StatusLed(haveConfig ? config.ledPin : 2, haveConfig && config.ledActiveLow);
  if (led.red == NO_PIN || !statusLeds::begin(&led, 1, config.outputs, haveConfig ? config.outputCount : 0)) {
    statusLeds::begin(nullptr, 0, nullptr, 0);
  }

  if (!haveConfig || requested) {
    LOGI("agent", haveConfig ? "setup requested" : "no configuration yet");
    disarmQuickRestart();
    portal::run(haveConfig ? &config : nullptr);
  }
  if (!agent.begin(config)) {
    // The saved outputs can't be driven (logged): show it, and offer the setup to fix them.
    statusLeds::show(AgentStatus::CONFIG_ERROR);
    portal::run(&config);
  }
}

void loop() {
  watchdogFeed();
  if (quickRestartArmed && millis() > QUICK_RESTART_WINDOW_MS) {
    quickRestartArmed = false;
    disarmQuickRestart();
  }
  agent.loop();
}
