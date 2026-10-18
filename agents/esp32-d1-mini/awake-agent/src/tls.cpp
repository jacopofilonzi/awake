#include "tls.h"

namespace tls {

void setup(NetworkClientSecure& client) {
  client.useBuiltinCACertBundle();
  client.setHandshakeTimeout(10);  // seconds: below the 30 s watchdog
}

}  // namespace tls
