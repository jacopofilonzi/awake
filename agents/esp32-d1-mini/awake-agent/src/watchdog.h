#pragma once

// Task watchdog on the loop task (PROTOCOL.md §8): a stuck TLS/Wi-Fi call ends in a reboot instead of a
// silent hang. 30 s: longer than the longest blocking call (TLS handshake, a probe).

void watchdogEnable();
void watchdogFeed();
