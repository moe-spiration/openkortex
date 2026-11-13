// Operational helpers for the public HTTP server: structured logs and in-memory rate limits.

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const SECRET_KEYS = /token|secret|password|authorization|code|verifier|cookie|key/i;

/** Drops values of secret-looking keys, so a log line can never carry a credential by accident. */
export function redact(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    // `client_id`, `token_type` and friends are fine; credentials are not.
    out[k] = SECRET_KEYS.test(k) && !/^(client_id|token_type|key_id)$/i.test(k) ? "[redacted]" : v;
  }
  return out;
}

/** One JSON object per line on stderr (stdout is the MCP channel in stdio mode). */
export function createLogger(
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  const emit = (level: string) => (msg: string, fields?: Record<string, unknown>) =>
    write(JSON.stringify({ ts: now().toISOString(), level, msg, ...redact(fields) }));
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export interface RateLimiter {
  /** True when the call is allowed (and counted). */
  take(key: string): boolean;
  /** Seconds until the key may try again (0 when allowed). */
  retryAfter(key: string): number;
}

/** Fixed-window counter per key; old windows are pruned lazily so memory stays bounded. */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const hits = new Map<string, { start: number; count: number }>();
  const entry = (key: string) => {
    const t = now();
    let e = hits.get(key);
    if (!e || t - e.start >= opts.windowMs) {
      if (!e && hits.size >= maxKeys) {
        for (const [k, v] of hits) if (t - v.start >= opts.windowMs) hits.delete(k);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
      }
      e = { start: t, count: 0 };
      hits.set(key, e);
    }
    return e;
  };
  return {
    take(key) {
      const e = entry(key);
      if (e.count >= opts.limit) return false;
      e.count++;
      return true;
    },
    retryAfter(key) {
      const e = hits.get(key);
      if (!e || e.count < opts.limit) return 0;
      return Math.max(1, Math.ceil((e.start + opts.windowMs - now()) / 1000));
    },
  };
}

/** Remembers values (token ids) until they expire; used for single-use codes and refresh rotation. */
export function createUsedSet(now: () => number = Date.now, maxEntries = 50_000) {
  const used = new Map<string, number>();
  const prune = () => {
    const t = now();
    for (const [k, exp] of used) if (exp <= t) used.delete(k);
    while (used.size > maxEntries) used.delete(used.keys().next().value as string);
  };
  return {
    /** Marks `id` used; false when it already was. */
    markUsed(id: string, expiresAtMs: number): boolean {
      prune();
      if (used.has(id)) return false;
      used.set(id, expiresAtMs);
      return true;
    },
    has: (id: string) => used.has(id) && (used.get(id) ?? 0) > now(),
  };
}
