#pragma once

#include "settings.h"

// Setup portal: the board opens the Wi-Fi network "Awake-Setup-XXXX" (password "awake-setup") and
// answers every DNS name with itself, so phones show the setup page on their own (captive portal). The
// page edits the configuration (settings.h): Wi-Fi, server, token, Wake-on-LAN port, status LED and
// outputs. Saving validates it with the same code as the firmware, stores it and restarts the board.
//
// Entered when there is no valid configuration, or on request (reset pressed twice quickly, or the BOOT
// button held at power-on, see awake-agent.ino). With a configuration already saved, it gives up after
// 10 minutes without a visit and restarts into normal mode, so a power glitch can't leave the agent
// stuck in setup.

namespace portal {

// Never returns: it ends with a restart. `current` prefills the page (secrets excluded); null if none.
[[noreturn]] void run(const Settings* current);

}  // namespace portal
