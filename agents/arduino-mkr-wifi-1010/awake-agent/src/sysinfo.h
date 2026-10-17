#pragma once

#include <stdint.h>

// What the board knows about itself, for the protocol's `info` (PROTOCOL.md §5.2): why it last reset,
// how long it has been running and how much RAM is free.
//
// The reset cause is the SAMD21's PM->RCAUSE register, which the hardware sets on every reset and nothing
// else writes; it is read once in begin(), the first call in setup(). The uptime is accumulated from
// millis() deltas in 64 bits, so it keeps counting past millis()' wrap-around (49.7 days) as long as
// tick() runs at least once per wrap (it runs on every loop()).

namespace sysinfo {

// Call first thing in setup(): reads the reset cause and starts the uptime.
void begin();

// Call from loop(): folds the time since the last call into the uptime.
void tick();

// Protocol value: "power", "brownout", "reset", "watchdog", "software" or "unknown".
const char* resetReason();

// Seconds since boot.
uint32_t uptimeSeconds();

// Bytes between the top of the heap and the stack pointer: the RAM still free for either.
uint32_t freeMemory();

}  // namespace sysinfo
