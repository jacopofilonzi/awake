// Cross-compiles the Go agent for the usual targets into <module dir>/bin.
// Usage: node scripts/build-agent.mjs <module dir>

import { execFileSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/build-agent.mjs <module dir>");
  process.exit(1);
}

const targets = [
  { GOOS: "windows", GOARCH: "amd64" },
  { GOOS: "linux", GOARCH: "amd64" },
  { GOOS: "linux", GOARCH: "arm64" }, // Raspberry Pi 3/4/5 with a 64-bit OS
  { GOOS: "linux", GOARCH: "arm", GOARM: "7" }, // Raspberry Pi 2/3/4 with a 32-bit OS
  { GOOS: "linux", GOARCH: "arm", GOARM: "6" }, // Raspberry Pi Zero / 1
  { GOOS: "darwin", GOARCH: "arm64" },
];

const version = execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { encoding: "utf8" }).trim();

for (const t of targets) {
  const suffix = `${t.GOOS}-${t.GOARCH}${t.GOARM ? `v${t.GOARM}` : ""}${t.GOOS === "windows" ? ".exe" : ""}`;
  const out = `bin/awake-agent-${suffix}`;
  execFileSync("go", ["build", "-trimpath", "-ldflags", `-s -w -X main.version=${version}`, "-o", out, "./cmd/awake-agent"], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, CGO_ENABLED: "0", ...t },
  });
  console.log(out);
}
