#pragma once

#include <stdint.h>

// Reconnection delays (PROTOCOL.md §8): 1 s doubling up to 60 s with ±20 % jitter, reset after a welcome.
// Some close codes (§7) impose a minimum, whose jitter only goes up.
class Backoff {
 public:
  void reset() { attempt_ = 0; }

  // Delay before the next attempt in ms; closeCode ended the last connection (0 when none was open).
  uint32_t next(uint16_t closeCode);

  // 4004: the server doesn't speak our protocol version, retrying is pointless until a firmware update.
  static bool isFatal(uint16_t closeCode) { return closeCode == 4004; }

 private:
  uint8_t attempt_ = 0;
};
