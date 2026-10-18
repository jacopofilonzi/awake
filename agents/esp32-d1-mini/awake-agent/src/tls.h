#pragma once

#include <NetworkClientSecure.h>

// TLS for wss://: the server certificate is validated against the root certificate bundle compiled into
// the ESP32 core (ESP-IDF's full Mozilla list: Let's Encrypt, Google Trust Services for Cloudflare…), so
// no certificate has to be configured or updated by hand.

namespace tls {

void setup(NetworkClientSecure& client);

}  // namespace tls
