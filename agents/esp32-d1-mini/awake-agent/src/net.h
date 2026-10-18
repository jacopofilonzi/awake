#pragma once

#include <Arduino.h>  // IPAddress
#include <stdint.h>

// LAN actions of the agent: Wake-on-LAN (PROTOCOL.md §9) and reachability probes (§4.2).

// "AA:BB:CC:DD:EE:FF" (either case) → 6 bytes.
bool parseMac(const char* text, uint8_t mac[6]);

// Broadcasts the magic packet to 255.255.255.255 and to the subnet's directed broadcast.
// True when at least one of the two was sent.
bool sendMagicPacket(const uint8_t mac[6], uint16_t port);

struct ProbeResult {
  bool up;
  int32_t ms;       // round trip, -1 when unknown
  const char* err;  // nullptr, or why the check could not be performed
};

// One ICMP echo (port 0) or one TCP connect. Blocks for up to timeoutMs.
ProbeResult probe(const IPAddress& ip, uint16_t port, uint32_t timeoutMs);
