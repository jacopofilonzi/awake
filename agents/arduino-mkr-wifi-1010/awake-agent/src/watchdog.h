#pragma once

// SAMD21 hardware watchdog (PROTOCOL.md §8): a stuck Wi-Fi/TLS stack ends in a reboot instead of a silent
// hang. The period is 16 s, the longest the chip allows; blocking library calls longer than that (Wi-Fi
// association) feed it through WiFi.setFeedWatchdogFunc.

void watchdogEnable();
void watchdogFeed();
