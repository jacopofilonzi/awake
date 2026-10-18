#include "backoff.h"

#include <Arduino.h>

uint32_t Backoff::next(uint16_t closeCode) {
  uint32_t base = 1000UL << (attempt_ < 6 ? attempt_ : 6);
  if (base > 60000) base = 60000;
  if (attempt_ < 6) attempt_++;
  uint32_t delayMs = base - base / 5 + random(0, 2 * base / 5 + 1);

  uint32_t minimum = 0;
  switch (closeCode) {
    case 4001:  // unknown token
    case 4003:  // token revoked
    case 4029:  // too many failed attempts from this IP
      minimum = 300000;
      break;
    case 4002:  // replaced by a newer connection with the same token
      minimum = 60000;
      break;
  }
  if (minimum && delayMs < minimum) delayMs = minimum + random(0, minimum / 5 + 1);
  return delayMs;
}
