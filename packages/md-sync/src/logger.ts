export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** One line per event: `2026-10-23T10:00:00.000Z info  pulled {"id":"..."}`. */
export function createConsoleLogger(minLevel: Level = "info"): Logger {
  const min = LEVELS.indexOf(minLevel);
  const log = (level: Level) => (message: string, data?: Record<string, unknown>) => {
    if (LEVELS.indexOf(level) < min) return;
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}${
      data ? ` ${JSON.stringify(data)}` : ""
    }`;
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}
