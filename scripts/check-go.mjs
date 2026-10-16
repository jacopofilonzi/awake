// `make check` for the Go agent: gofmt must report nothing, go vet must pass.
// Usage: node scripts/check-go.mjs <module dir>

import { execFileSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/check-go.mjs <module dir>");
  process.exit(1);
}

const unformatted = execFileSync("gofmt", ["-l", "."], { cwd: dir, encoding: "utf8" }).trim();
if (unformatted) {
  console.error(`gofmt: these files need formatting (run gofmt -w):\n${unformatted}`);
  process.exit(1);
}
execFileSync("go", ["vet", "./..."], { cwd: dir, stdio: "inherit" });
