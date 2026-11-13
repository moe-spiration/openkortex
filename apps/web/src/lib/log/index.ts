// Structured JSON logger (one line per event on stdout/stderr, easy for Coolify/Loki) with
// redaction of secrets and e-mail addresses, plus request ids. No dependencies.

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY = /(authorization|cookie|token|secret|password|api[-_]?key|anon[-_]?key|jwt|bearer|apikey)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const PROVIDER_KEY = /\b(sk|pk)-[A-Za-z0-9_-]{12,}/g;

export function redactString(s: string): string {
  return s
    .replace(BEARER, "$1 [redacted]")
    .replace(JWT, "[redacted-jwt]")
    .replace(PROVIDER_KEY, "[redacted-key]")
    .replace(EMAIL, "[redacted-email]");
}

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 5) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const wanted = process.env.LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined;
  return ORDER[wanted ?? "info"] ?? ORDER.info;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(base: Record<string, unknown> = {}, sink: (line: string, level: LogLevel) => void = defaultSink): Logger {
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < threshold()) return;
    const record = { time: new Date().toISOString(), level, msg: redactString(msg), ...(redact({ ...base, ...fields }) as object) };
    sink(JSON.stringify(record), level);
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (f) => createLogger({ ...base, ...f }, sink),
  };
}

function defaultSink(line: string, level: LogLevel): void {
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = createLogger({ app: "kortex-web" });

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses a sane inbound `x-request-id` (from the proxy) or mints a new one. */
export function requestId(request: Request): string {
  const inbound = request.headers.get("x-request-id")?.trim();
  return inbound && REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
}
