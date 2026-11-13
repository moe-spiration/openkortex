import { AsyncLocalStorage } from "node:async_hooks";
import { ApiError } from "../api-error";
import type { ServerDeps } from "../deps";
import {
  budgetDay,
  budgetMessage,
  loadBudgetStatus,
  usageRow,
  type BudgetStatus,
  type UsageEntry,
} from "@kortex/ai-core";

export { budgetDay, budgetMessage, DEFAULT_DAILY_BUDGET_EUR, type BudgetStatus, type UsageEntry } from "@kortex/ai-core";

/*
 * AI usage per user and day (kortex.ai_usage) and the daily budget (user_settings.
 * daily_ai_budget_eur). Written and read with the service role: users cannot insert or change
 * usage rows themselves (RLS), so they cannot talk their spend down.
 */

/** Metering needs the service role; without it usage is not recorded (warned once). */
let warnedNoService = false;
function serviceOrNull(deps: Pick<ServerDeps, "clients" | "env" | "log">) {
  if (!deps.env.supabaseServiceRoleKey) {
    if (!warnedNoService) deps.log.error("limits: SUPABASE_SERVICE_ROLE_KEY fehlt, KI-Verbrauch wird nicht gemessen", null);
    warnedNoService = true;
    return null;
  }
  return deps.clients.service();
}

/** Stores one metered call. Never throws: a failed write is logged (the call already happened). */
export async function recordUsage(deps: Pick<ServerDeps, "clients" | "env" | "log" | "now">, e: UsageEntry): Promise<void> {
  const service = serviceOrNull(deps);
  if (!service) return;
  try {
    const { error } = await service.from("ai_usage").insert(usageRow(e, budgetDay(deps.env.raw, deps.now())));
    if (error) throw new Error(error.message);
  } catch (err) {
    deps.log.error("limits: recordUsage failed", err);
  }
}

/** Today's spend vs. the user's daily budget. */
export async function budgetStatus(deps: Pick<ServerDeps, "clients" | "env" | "log" | "now">, userId: string): Promise<BudgetStatus | null> {
  const service = serviceOrNull(deps);
  if (!service) return null;
  return loadBudgetStatus(service, userId, deps.env.raw, deps.now());
}

/** Throws `budget_exceeded` (402) when today's spend reached the budget. */
export async function checkBudget(deps: Pick<ServerDeps, "clients" | "env" | "log" | "now">, userId: string): Promise<BudgetStatus | null> {
  const s = await budgetStatus(deps, userId);
  if (s?.exceeded)
    throw new ApiError("budget_exceeded", budgetMessage(s), {
      details: { spent_eur: round2(s.spentEur), budget_eur: s.budgetEur, day: s.day },
    });
  return s;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Request context: who pays for the AI calls made while handling this request ----------------

export interface UsageContext {
  userId: string;
}

const storage = new AsyncLocalStorage<UsageContext>();

/** Runs `fn` with `ctx` as the payer of every metered AI call started inside it. */
export function withUsageContext<T>(ctx: UsageContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentUsageContext(): UsageContext | undefined {
  return storage.getStore();
}
