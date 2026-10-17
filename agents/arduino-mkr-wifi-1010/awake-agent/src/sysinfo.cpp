#include "sysinfo.h"

#include <Arduino.h>

extern "C" char* sbrk(int incr);  // newlib: sbrk(0) is the current end of the heap

namespace sysinfo {

namespace {

const char* reason = "unknown";
uint64_t uptimeMs = 0;
uint32_t lastMillis = 0;

const char* readResetCause() {
  const uint8_t cause = PM->RCAUSE.reg;
  // Power-on can set the brown-out bits too (the supply ramps up through their thresholds): check POR first.
  if (cause & PM_RCAUSE_POR) return "power";
  if (cause & (PM_RCAUSE_BOD12 | PM_RCAUSE_BOD33)) return "brownout";
  if (cause & PM_RCAUSE_WDT) return "watchdog";
  if (cause & PM_RCAUSE_SYST) return "software";  // NVIC_SystemReset, e.g. after an upload over USB
  if (cause & PM_RCAUSE_EXT) return "reset";      // the reset button
  return "unknown";
}

}  // namespace

void begin() {
  reason = readResetCause();
  lastMillis = millis();
  uptimeMs = lastMillis;
}

void tick() {
  const uint32_t now = millis();
  uptimeMs += (uint32_t)(now - lastMillis);  // unsigned difference: correct across the wrap
  lastMillis = now;
}

const char* resetReason() { return reason; }

uint32_t uptimeSeconds() {
  tick();
  return (uint32_t)(uptimeMs / 1000);
}

uint32_t freeMemory() {
  char top;
  const char* heapEnd = sbrk(0);
  return &top > heapEnd ? (uint32_t)(&top - heapEnd) : 0;
}

}  // namespace sysinfo
