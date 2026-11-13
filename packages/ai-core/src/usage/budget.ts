import { t } from "../i18n";
import type { KortexClient } from "@kortex/db";
import { formatEur, usdToEur } from "./pricing";

/*
 * Daily AI budget (S2a): spend per user and calendar day in kortex.ai_usage against
 * user_settings.daily_ai_budget_eur. Usage rows are written with the service role only (RLS), so
 * users cannot talk their spend down. The web server, md-sync and the MCP organizer share this.
 */

type Env = Record<string, string | undefined>;

/** Default daily budget when the settings row has none (EUR). */
export const DEFAULT_DAILY_BUDGET_EUR = 2;

/** Calendar day in the Kortex time zone (KORTEX_TIMEZONE, default Europe/Berlin): the budget window. */
export function budgetDay(env: Env, now = new Date()): string {
  const timeZone = env.KORTEX_TIMEZONE?.trim() || "Europe/Berlin";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const usdPerEurOf = (env: Env) => Number(env.KORTEX_USD_PER_EUR) || 1.08;

export interface UsageEntry {
  userId: string;
  provider: string;
  task: string;
  modelId: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  estimated: boolean;
}

/** One kortex.ai_usage row. */
export function usageRow(e: UsageEntry, day: string) {
  return {
    user_id: e.userId,
    day,
    provider: e.provider,
    task: e.task,
    model_id: e.modelId,
    input_tokens: Math.max(0, Math.round(e.inputTokens)),
    output_tokens: Math.max(0, Math.round(e.outputTokens)),
    cost_usd: Math.max(0, e.costUsd),
    estimated: e.estimated,
  };
}

export interface BudgetStatus {
  day: string;
  spentEur: number;
  budgetEur: number;
  remainingEur: number;
  exceeded: boolean;
}

/** Status from the day's usage costs (USD) and the raw settings value. */
export function budgetStatusFrom(input: {
  day: string;
  costsUsd: readonly unknown[];
  budgetRaw: unknown;
  env: Env;
}): BudgetStatus {
  const spentUsd = input.costsUsd.reduce<number>((sum, c) => sum + (Number(c) || 0), 0);
  const spentEur = usdToEur(spentUsd, usdPerEurOf(input.env));
  const raw = input.budgetRaw;
  const budgetEur = raw === null || raw === undefined ? DEFAULT_DAILY_BUDGET_EUR : Number(raw);
  return {
    day: input.day,
    spentEur,
    budgetEur,
    remainingEur: Math.max(0, budgetEur - spentEur),
    exceeded: spentEur >= budgetEur,
  };
}

/** Today's status. `client` must see the user's usage rows (service role or the user's client). */
export async function loadBudgetStatus(
  client: KortexClient,
  userId: string,
  env: Env,
  now = new Date(),
): Promise<BudgetStatus> {
  const day = budgetDay(env, now);
  const [usage, settings] = await Promise.all([
    client.from("ai_usage").select("cost_usd").eq("user_id", userId).eq("day", day).limit(20_000),
    client.from("user_settings").select("daily_ai_budget_eur").eq("user_id", userId).maybeSingle(),
  ]);
  if (usage.error) throw new Error(`load ai_usage: ${usage.error.message}`);
  if (settings.error) throw new Error(`load budget: ${settings.error.message}`);
  return budgetStatusFrom({
    day,
    costsUsd: (usage.data ?? []).map((r) => r.cost_usd),
    budgetRaw: settings.data?.daily_ai_budget_eur,
    env,
  });
}

/** The message every surface shows when the day's budget is used up. */
export function budgetMessage(s: Pick<BudgetStatus, "spentEur" | "budgetEur">): string {
  return t(
    "Daily AI budget reached ({spent} of {budget}). It continues tomorrow, or raise the budget under Settings → AI models & routing.",
    { spent: formatEur(s.spentEur), budget: formatEur(s.budgetEur) },
  );
}

/** Budget check and usage log for one user outside a web request (md-sync, MCP organizer). */
export interface UsageLedger {
  /** Today's status; null when it cannot be read (AI work then goes ahead, like the web server). */
  status(): Promise<BudgetStatus | null>;
  /** Stores one metered call. Never throws. */
  record(entry: Omit<UsageEntry, "userId">): Promise<void>;
}

/**
 * Ledger on Supabase. Reading works with the user's client or the service role; writing usage
 * needs the service role (RLS), so with a user client `record` only reports the error.
 */
export function createSupabaseUsageLedger(opts: {
  client: KortexClient;
  userId: string;
  env: Env;
  now?: () => Date;
  onError?: (message: string, error: unknown) => void;
}): UsageLedger {
  const now = opts.now ?? (() => new Date());
  const onError = opts.onError ?? (() => {});
  return {
    async status() {
      try {
        return await loadBudgetStatus(opts.client, opts.userId, opts.env, now());
      } catch (error) {
        onError("budget check failed", error);
        return null;
      }
    },
    async record(entry) {
      try {
        const row = usageRow({ ...entry, userId: opts.userId }, budgetDay(opts.env, now()));
        const { error } = await opts.client.from("ai_usage").insert(row);
        if (error) throw new Error(error.message);
      } catch (error) {
        onError("recording ai usage failed", error);
      }
    },
  };
}
