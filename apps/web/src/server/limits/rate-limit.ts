/*
 * Per-user sliding-window rate limits (S2a). In-memory: correct for the single web instance Kortex
 * runs today. With several instances, move the window into Postgres or Redis (same interface).
 */

export const LIMIT_KINDS = ["ingest", "chat", "chat_action", "transcribe", "models", "digest", "search"] as const;
export type LimitKind = (typeof LIMIT_KINDS)[number];

export interface RateRule {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

/** Defaults per minute; override with KORTEX_RATE_<KIND>=<max>[/<seconds>] (e.g. KORTEX_RATE_CHAT=30/60). */
export const DEFAULT_RULES: Record<LimitKind, RateRule> = {
  ingest: { max: 30, windowMs: 60_000 },
  chat: { max: 20, windowMs: 60_000 },
  chat_action: { max: 20, windowMs: 60_000 },
  // The desktop's live meeting sends both channels every 12-20 s (up to ~10 a minute) plus the
  // final pass; 10 a minute dropped live chunks (device test 0.6.2).
  transcribe: { max: 40, windowMs: 60_000 },
  models: { max: 30, windowMs: 60_000 },
  digest: { max: 5, windowMs: 60_000 },
  // Search-as-you-type from the desktop launcher (debounced, one request per pause).
  search: { max: 120, windowMs: 60_000 },
};

/** Rules with env overrides applied. */
export function rulesFromEnv(env: Record<string, string | undefined>): Record<LimitKind, RateRule> {
  const out = { ...DEFAULT_RULES };
  for (const kind of LIMIT_KINDS) {
    const raw = env[`KORTEX_RATE_${kind.toUpperCase()}`]?.trim();
    const m = raw ? /^(\d+)(?:\/(\d+))?$/.exec(raw) : null;
    if (m) out[kind] = { max: Number(m[1]), windowMs: (m[2] ? Number(m[2]) : 60) * 1000 };
  }
  return out;
}

export interface RateDecision {
  ok: boolean;
  /** Requests left in the current window after this one. */
  remaining: number;
  /** When a refused request may retry (seconds, rounded up). */
  retryAfterSec: number;
}

export function createRateLimiter(rules: Record<LimitKind, RateRule>, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    /** Counts one request of `kind` for `userId` if the window has room. */
    hit(userId: string, kind: LimitKind): RateDecision {
      const rule = rules[kind];
      const t = now();
      const key = `${userId}:${kind}`;
      const recent = (hits.get(key) ?? []).filter((ts) => ts > t - rule.windowMs);
      if (recent.length >= rule.max) {
        hits.set(key, recent);
        return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + rule.windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      // Keep the map small: drop users without recent requests now and then.
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((ts) => ts > t - 3_600_000)) hits.delete(k);
      return { ok: true, remaining: rule.max - recent.length, retryAfterSec: 0 };
    },
    reset: () => hits.clear(),
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;
