#include "log.h"

#include <Arduino.h>
#include <stdarg.h>

void logLine(const char* level, const char* tag, const char* fmt, ...) {
  char msg[200];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(msg, sizeof msg, fmt, ap);
  va_end(ap);

  const unsigned long now = millis();
  char line[256];
  snprintf(line, sizeof line, "%lu.%03lu %s [%s] %s", now / 1000, now % 1000, level, tag, msg);
  Serial.println(line);
}
