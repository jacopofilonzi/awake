// Entry point. `index.ts` starts the server; `index.ts reset-password <username>` is the recovery
// command for a lost password (prints a new temporary one, to be changed at next login).

import { startServer } from "./app.ts";
import { resetPassword } from "./auth/users.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { log } from "./log.ts";
import { VERSION } from "./version.ts";

let config;
try {
  config = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  log.error("config", err.message);
  process.exit(1);
}

// --api-only: do not serve the web UI (development, where Vite serves it).
const argv = process.argv.slice(2);
if (argv.includes("--api-only")) config.webDir = null;
const [command, arg] = argv.filter((a) => a !== "--api-only");

if (command === "reset-password") {
  if (!arg) {
    log.error("cli", "usage: reset-password <username>");
    process.exit(1);
  }
  const db = openDb(config.dataDir);
  try {
    const password = await resetPassword(db, arg);
    process.stdout.write(`New temporary password for ${arg.toLowerCase()}: ${password}\n(to be changed at the next login)\n`);
  } catch (err) {
    log.error("cli", (err as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
} else if (command) {
  log.error("cli", `unknown command "${command}" (available: reset-password <username>)`);
  process.exit(1);
} else {
  const server = await startServer(config);
  log.info("server", `Awake ${VERSION} listening`, { port: server.port, publicUrl: config.publicUrl, dataDir: config.dataDir });
  if (server.bootstrapPassword) {
    const lines = [
      "First start: created the administrator account.",
      "  username: admin",
      `  password: ${server.bootstrapPassword}`,
      "The password must be changed at the first login and is not shown again.",
      "Lost it? Run the reset-password command (see README).",
    ];
    process.stdout.write(`\n${"=".repeat(72)}\n${lines.join("\n")}\n${"=".repeat(72)}\n\n`);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}
