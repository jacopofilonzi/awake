#pragma once

#include <stdint.h>

// What the agent reports about itself in `info` (PROTOCOL.md §5.2): why it last started, how long it has
// been running and how much heap is free.

namespace sysinfo {

// Protocol value for esp_reset_reason(): power, watchdog, reset, software, brownout or unknown.
const char* resetReason();
uint32_t uptimeSeconds();  // from the 64-bit microsecond timer: no wrap-around
uint32_t freeMemory();     // free heap, bytes

}  // namespace sysinfo
