import { t } from "@/i18n";
import { ApiError } from "../api-error";
import type { RouteContext } from "../route";
import { checkAccess } from "./access";
import { createRateLimiter, rulesFromEnv, type LimitKind, type RateLimiter } from "./rate-limit";
import { checkBudget, type BudgetStatus } from "./usage";

/*
 * S2a guard for API routes. Every route already gets the allowlist check from the `route()`
 * wrapper; AI routes additionally call
 *
 *   await enforceLimits(ctx, "chat");     // ctx = the RouteContext the handler receives
 *
 * which applies the per-user rate limit for that kind (429 + Retry-After) and, for kinds that
 * spend AI money, the daily budget (402 budget_exceeded). Models handed out inside the request
 * are metered when wrapped with `meterRouter` (see ./meter).
 */

export { checkAccess, isAllowed, noAccessMessage, resetAccessCache } from "./access";
export { meterEmbeddingModel, meterLanguageModel, meterRouter } from "./meter";
export { DEFAULT_RULES, LIMIT_KINDS, type LimitKind } from "./rate-limit";
export {
  budgetDay,
  budgetMessage,
  budgetStatus,
  checkBudget,
  currentUsageContext,
  DEFAULT_DAILY_BUDGET_EUR,
  recordUsage,
  withUsageContext,
  type BudgetStatus,
  type UsageEntry,
} from "./usage";

/** Kinds that cost AI money (budget checked before they run). */
const SPENDS: Record<LimitKind, boolean> = {
  ingest: true,
  chat: true,
  chat_action: true,
  transcribe: true,
  digest: true,
  models: false,
  // Only a query embedding (metered all the same); full-text search must keep working on an empty budget.
  search: false,
};

let limiter: RateLimiter | null = null;
let limiterEnv: Record<string, string | undefined> | null = null;

function getLimiter(ctx: Pick<RouteContext, "deps">): RateLimiter {
  // One limiter per env (the test deps bring their own env; the server has exactly one).
  if (!limiter || limiterEnv !== ctx.deps.env.raw) {
    limiter = createRateLimiter(rulesFromEnv(ctx.deps.env.raw), () => ctx.deps.now().getTime());
    limiterEnv = ctx.deps.env.raw;
  }
  return limiter;
}

/** Allowlist (cached) + rate limit + (for AI kinds) daily budget. Throws ApiError. */
export async function enforceLimits(ctx: Pick<RouteContext, "auth" | "deps">, kind: LimitKind): Promise<BudgetStatus | null> {
  await checkAccess(ctx.auth, ctx.deps);
  const d = getLimiter(ctx).hit(ctx.auth.userId, kind);
  if (!d.ok)
    throw new ApiError("rate_limited", t("Too many requests, please try again in {sec} s", { sec: d.retryAfterSec }), {
      details: { kind, retry_after_sec: d.retryAfterSec },
    });
  return SPENDS[kind] ? checkBudget(ctx.deps, ctx.auth.userId) : null;
}

/** Tests: start with empty windows. */
export const resetRateLimits = () => {
  limiter = null;
  limiterEnv = null;
};
