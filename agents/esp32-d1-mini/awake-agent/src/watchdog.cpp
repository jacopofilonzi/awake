#include "watchdog.h"

#include <esp_task_wdt.h>

#include "log.h"

void watchdogEnable() {
  esp_task_wdt_config_t config = {};
  config.timeout_ms = 30000;
  config.idle_core_mask = 0;  // only the loop task is watched
  config.trigger_panic = true;
  // The core may or may not have started the task watchdog already: reconfigure, else initialize.
  esp_err_t err = esp_task_wdt_reconfigure(&config);
  if (err == ESP_ERR_INVALID_STATE) err = esp_task_wdt_init(&config);
  if (err == ESP_OK) err = esp_task_wdt_add(nullptr);
  if (err != ESP_OK) LOGW("watchdog", "not enabled (%s)", esp_err_to_name(err));
}

void watchdogFeed() { esp_task_wdt_reset(); }
