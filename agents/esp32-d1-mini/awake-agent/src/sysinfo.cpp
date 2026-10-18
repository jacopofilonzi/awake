#include "sysinfo.h"

#include <Arduino.h>
#include <esp_system.h>
#include <esp_timer.h>

namespace sysinfo {

const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:
      // The EN/reset pin of the ESP32 is a chip enable: pressing the board's RST button also reads as
      // power-on. Only a real power cycle and that button end up here.
      return "power";
    case ESP_RST_BROWNOUT:
      return "brownout";
    case ESP_RST_TASK_WDT:
    case ESP_RST_INT_WDT:
    case ESP_RST_WDT:
      return "watchdog";
    case ESP_RST_SW:     // ESP.restart(): after saving the setup, for instance
    case ESP_RST_PANIC:  // a crash: the firmware restarted itself
      return "software";
    case ESP_RST_EXT:
      return "reset";
    default:
      return "unknown";
  }
}

uint32_t uptimeSeconds() { return (uint32_t)(esp_timer_get_time() / 1000000LL); }

uint32_t freeMemory() { return ESP.getFreeHeap(); }

}  // namespace sysinfo
