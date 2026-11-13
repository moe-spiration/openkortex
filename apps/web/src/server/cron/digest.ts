import { localeOfSettings } from "../locale";
import { runWithLocale } from "@/i18n/server";
import { z } from "zod";
import type { KortexClient } from "@kortex/db";
import type { AuthContext } from "../auth";
import { modelSettingsFor } from "../chat/handler";
import type { ServerDeps } from "../deps";
import { isoWeek } from "../digest/service";
import { generateSynthesis, monthlyPeriod, weeklyPeriod } from "../digest/synthesis";
import { budgetStatus, withUsageContext } from "../limits/usage";
import { getUserSettings } from "../repo";

/*
 * Weekly and monthly syntheses from the server cron (POST /api/cron/digest, hourly). For every allowlisted user
 * whose user_settings.weekly_digest_day (0 = Sunday … 6 = Saturday) has come in KORTEX_TIMEZONE
 * (default Europe/Berlin) and whose local hour reached KORTEX_DIGEST_HOUR (default 7), one run per
 * ISO week is claimed in kortex.cron_runs and generateSynthesis() writes ONE deep weekly synthesis
 * (summarize route) to 90_Digests/Weekly/YYYY-Www.md. On the 1st of the month (same hour rule) a
 * second job claims the month that just ended and writes 90_Digests/Monthly/YYYY-MM.md
 * (chat_reasoning route). Both refresh 40_AI_Memories/Focus-Profile.md. The per-group project
 * digests stay available on demand via POST /api/digest. AI calls are metered to that user, and a
 * user over their day budget is skipped (retried later, at most MAX_ATTEMPTS times per period).
 */

export const DIGEST_JOB = "weekly_digest";
export const MONTHLY_DIGEST_JOB = "monthly_digest";
export type CronJob = typeof DIGEST_JOB | typeof MONTHLY_DIGEST_JOB;
const MAX_ATTEMPTS = 3;
/** A failed run is retried after this long; a "running" row older than STALE_MS counts as dead. */
const RETRY_MS = 6 * 3600_000;
const STALE_MS = 2 * 3600_000;

export const CronDigestRequestSchema = z.object({
  /** Which jobs to consider (default both; each still follows its own schedule unless force). */
  jobs: z
    .array(z.enum(["weekly", "monthly"]))
    .min(1)
    .default(["weekly", "monthly"]),
  /** Ignore weekday/1st-of-month and hour (manual run, tests). Runs already done still count. */
  force: z.boolean().default(false),
  /** Run again even if this week's digest was done (only with force). */
  rerun: z.boolean().default(false),
  /** Only these users (still must be allowlisted). */
  user_ids: z.array(z.string().uuid()).max(100).optional(),
  /** Report who is due without generating anything. */
  dry_run: z.boolean().default(false),
  /** Users per call; the rest are picked up by the next hourly call. */
  limit: z.number().int().min(1).max(100).default(25),
});
export type CronDigestRequest = z.infer<typeof CronDigestRequestSchema>;

export interface CronDigestUserResult {
  user_id: string;
  job: CronJob;
  period: string;
  status: "done" | "error" | "skipped" | "due";
  digests?: number;
  item_ids?: string[];
  reason?: string;
}

export interface CronDigestResponse {
  ok: true;
  now: string;
  timezone: string;
  checked: number;
  results: CronDigestUserResult[];
}

/** Weekday (0 = Sunday), hour and calendar date of `at` in `timeZone`. */
export function localTime(
  at: Date,
  timeZone: string,
): { weekday: number; hour: number; date: Date } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return {
    weekday,
    hour: Number(parts.hour),
    date: new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))),
  };
}

export const weekKey = (localDate: Date) => {
  const { year, week } = isoWeek(localDate);
  return `${year}-W${String(week).padStart(2, "0")}`;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2000);

/** Claims (user, job, period). True when this call may run it. */
async function claim(
  svc: KortexClient,
  job: CronJob,
  userId: string,
  period: string,
  now: Date,
  rerun: boolean,
): Promise<boolean> {
  const row = {
    user_id: userId,
    job,
    period,
    status: "running",
    attempts: 1,
    started_at: now.toISOString(),
  };
  const ins = await svc.from("cron_runs").insert(row);
  if (!ins.error) return true;
  if (ins.error.code !== "23505") throw new Error(`cron claim: ${ins.error.message}`);

  const { data: prev, error } = await svc
    .from("cron_runs")
    .select("status,attempts,started_at")
    .eq("user_id", userId)
    .eq("job", job)
    .eq("period", period)
    .maybeSingle();
  if (error || !prev) return false;
  const age = now.getTime() - new Date(prev.started_at).getTime();
  const again =
    (rerun && prev.status !== "running") ||
    (prev.status === "error" && prev.attempts < MAX_ATTEMPTS && age >= RETRY_MS) ||
    (prev.status === "running" && age >= STALE_MS);
  if (!again) return false;
  // Conditional update: only one caller wins when two race for the same row.
  const { data: won } = await svc
    .from("cron_runs")
    .update({
      status: "running",
      attempts: Math.min(100, prev.attempts + 1),
      started_at: now.toISOString(),
      finished_at: null,
      error: null,
    })
    .eq("user_id", userId)
    .eq("job", job)
    .eq("period", period)
    .eq("status", prev.status)
    .eq("attempts", prev.attempts)
    .select("user_id");
  return (won ?? []).length > 0;
}

async function finish(
  svc: KortexClient,
  job: CronJob,
  userId: string,
  period: string,
  now: Date,
  patch: { status: "done" | "error" | "skipped"; result?: unknown; error?: string | null },
) {
  await svc
    .from("cron_runs")
    .update({ ...patch, result: (patch.result ?? null) as never, finished_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("job", job)
    .eq("period", period);
}

export async function runWeeklyDigests(
  deps: ServerDeps,
  req: CronDigestRequest,
): Promise<CronDigestResponse> {
  const svc = deps.clients.service();
  const now = deps.now();
  const timeZone = deps.env.raw.KORTEX_TIMEZONE?.trim() || "Europe/Berlin";
  // A non-numeric or out-of-range value falls back to 7 (NaN would silently disable all digests).
  const configuredHour = Number(deps.env.raw.KORTEX_DIGEST_HOUR?.trim() || 7);
  const hourFrom =
    Number.isInteger(configuredHour) && configuredHour >= 0 && configuredHour <= 23
      ? configuredHour
      : 7;
  const local = localTime(now, timeZone);

  let allowed = svc.from("allowed_users").select("user_id").order("user_id").limit(1000);
  if (req.user_ids?.length) allowed = allowed.in("user_id", req.user_ids);
  const { data: users, error } = await allowed;
  if (error) throw new Error(`cron: load allowlist: ${error.message}`);
  const ids = (users ?? []).map((u) => u.user_id as string);
  if (!ids.length)
    return { ok: true, now: now.toISOString(), timezone: timeZone, checked: 0, results: [] };

  const { data: settings, error: sErr } = await svc
    .from("user_settings")
    .select("user_id,weekly_digest_day")
    .in("user_id", ids);
  if (sErr) throw new Error(`cron: load settings: ${sErr.message}`);
  const dayOf = new Map(
    (settings ?? []).map((s) => [s.user_id as string, s.weekly_digest_day as number]),
  );

  const scheduledHour = local.hour >= hourFrom;
  const plans: Array<{ job: CronJob; period: ReturnType<typeof weeklyPeriod>; users: string[] }> =
    [];
  if (req.jobs.includes("weekly"))
    plans.push({
      job: DIGEST_JOB,
      period: weeklyPeriod(local.date, now),
      users: ids.filter(
        (id) => dayOf.has(id) && (req.force || (dayOf.get(id) === local.weekday && scheduledHour)),
      ),
    });
  if (req.jobs.includes("monthly"))
    plans.push({
      job: MONTHLY_DIGEST_JOB,
      period: monthlyPeriod(local.date),
      users: ids.filter(
        (id) => dayOf.has(id) && (req.force || (local.date.getUTCDate() === 1 && scheduledHour)),
      ),
    });
  const results: CronDigestUserResult[] = [];
  if (req.dry_run) {
    for (const p of plans)
      for (const id of p.users)
        results.push({ user_id: id, job: p.job, period: p.period.key, status: "due" });
    return { ok: true, now: now.toISOString(), timezone: timeZone, checked: ids.length, results };
  }

  const catalog = plans.some((p) => p.users.length) ? await deps.loadCatalog() : [];
  let started = 0;
  // Weekly first: the monthly synthesis of the same night reads the weekly ones.
  for (const { job, period: p, users } of plans) {
    const period = p.key;
    for (const userId of users) {
      if (started >= req.limit) break;
      if (!(await claim(svc, job, userId, period, now, req.force && req.rerun))) continue;
      started++;
      try {
        const budget = await budgetStatus(deps, userId).catch(() => null);
        if (budget?.exceeded) {
          await finish(svc, job, userId, period, deps.now(), {
            status: "error",
            error: "budget_exceeded",
          });
          results.push({
            user_id: userId,
            job,
            period,
            status: "skipped",
            reason: "budget_exceeded",
          });
          continue;
        }
        const ctx: AuthContext = { userId, mode: "api_token", client: svc };
        const userSettings = await getUserSettings(svc, userId);
        const models = deps.createModels(
          modelSettingsFor(userSettings, undefined, catalog),
          catalog,
        );
        // The digest is written for this user: title, headings and prompt in the account language
        // (the period is rebuilt inside, its label and title are language-dependent).
        const out = await runWithLocale(localeOfSettings(userSettings), () =>
          withUsageContext({ userId }, () =>
            generateSynthesis(
              deps,
              ctx,
              job === DIGEST_JOB ? weeklyPeriod(local.date, now) : monthlyPeriod(local.date),
              models,
              { rerun: req.force && req.rerun },
            ),
          ),
        );
        const written = out.status === "created" || out.status === "updated";
        const itemIds = written && out.item_id ? [out.item_id] : [];
        await finish(svc, job, userId, period, deps.now(), {
          status: "done",
          result: { ...out, digests: itemIds.length, item_ids: itemIds },
        });
        results.push({
          user_id: userId,
          job,
          period,
          status: "done",
          digests: itemIds.length,
          item_ids: itemIds,
        });
      } catch (err) {
        deps.log.error(`cron ${job} ${userId}`, err);
        await finish(svc, job, userId, period, deps.now(), {
          status: "error",
          error: message(err),
        }).catch(() => {});
        results.push({ user_id: userId, job, period, status: "error", reason: message(err) });
      }
    }
  }
  return { ok: true, now: now.toISOString(), timezone: timeZone, checked: ids.length, results };
}
