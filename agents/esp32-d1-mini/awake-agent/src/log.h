#pragma once

// Leveled one-line logs on the USB serial port (115200 baud): "<uptime s>.<ms> LEVEL [tag] message".
// Nothing is written while no serial monitor is open. Never pass the token to these functions.

void logLine(const char* level, const char* tag, const char* fmt, ...) __attribute__((format(printf, 3, 4)));

#define LOGI(tag, ...) logLine("INFO ", tag, __VA_ARGS__)
#define LOGW(tag, ...) logLine("WARN ", tag, __VA_ARGS__)
#define LOGE(tag, ...) logLine("ERROR", tag, __VA_ARGS__)
