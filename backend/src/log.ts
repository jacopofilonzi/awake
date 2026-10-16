// Minimal leveled logger: one line per event, `time LEVEL [scope] message key=value…`.
// Never pass secrets (tokens, passwords, cookies) as fields.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

export function setLogLevel(level: Level | "silent"): void {
  threshold = level === "silent" ? Infinity : ORDER[level];
}

type Fields = Record<string, unknown>;

function write(level: Level, scope: string, msg: string, fields?: Fields): void {
  if (ORDER[level] < threshold) return;
  let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const s = v instanceof Error ? v.message : typeof v === "string" ? v : JSON.stringify(v);
      line += ` ${k}=${/[\s"=]/.test(s) ? JSON.stringify(s) : s}`;
    }
  }
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (scope: string, msg: string, fields?: Fields) => write("debug", scope, msg, fields),
  info: (scope: string, msg: string, fields?: Fields) => write("info", scope, msg, fields),
  warn: (scope: string, msg: string, fields?: Fields) => write("warn", scope, msg, fields),
  error: (scope: string, msg: string, fields?: Fields) => write("error", scope, msg, fields),
};
