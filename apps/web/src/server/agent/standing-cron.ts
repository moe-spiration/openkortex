import { duePeriod, type LocalMoment } from "@/lib/agent-jobs";
import type { AuthContext } from "../auth";
import { localTime, weekKey } from "../cron/digest";
import type { ServerDeps } from "../deps";
import { budgetStatus } from "../limits/usage";
import { createJob, runJob, toOrderView } from "./jobs";

/*
 * Standing orders, run by the hourly server cron (POST /api/cron/agent, and along with
 * POST /api/cron/digest so no extra scheduled task is needed). For every enabled order whose time
 * has come it claims the period (`last_period`), queues a job and runs it with the service role,
 * filtered by the order's user. One run per order and day (daily) or week (weekly).
 */

const ORDER_COLUMNS = "id,user_id,title,prompt,skill,cadence,hour,weekday,autonomy,enabled,last_period" as const;

export interface StandingRun {
  order_id: string;
  user_id: string;
  period: string;
  status: "started" | "skipped";
  job_id?: string;
  reason?: string;
}

export const localMoment = (now: Date, timeZone: string): LocalMoment => {
  const local = localTime(now, timeZone);
  return { date: local.date.toISOString().slice(0, 10), week: weekKey(local.date), weekday: local.weekday === 0 ? 7 : local.weekday, hour: local.hour };
};

export async function runStandingOrders(deps: ServerDeps, opts: { limit?: number } = {}): Promise<{ ok: true; checked: number; runs: StandingRun[] }> {
  const svc = deps.clients.service();
  const now = deps.now();
  const at = localMoment(now, deps.env.raw.KORTEX_TIMEZONE?.trim() || "Europe/Berlin");
  const { data, error } = await svc.from("agent_standing_orders").select(ORDER_COLUMNS).eq("enabled", true).lte("hour", at.hour).limit(500);
  if (error) throw new Error(`cron agent: load orders: ${error.message}`);
  const due = (data ?? []).flatMap((row) => {
    const period = duePeriod(toOrderView(row), at);
    return period ? [{ row, period }] : [];
  });
  const runs: StandingRun[] = [];
  if (!due.length) return { ok: true, checked: data?.length ?? 0, runs };

  const { data: allowed, error: aErr } = await svc.from("allowed_users").select("user_id").in("user_id", [...new Set(due.map((d) => d.row.user_id))]);
  if (aErr) throw new Error(`cron agent: load allowlist: ${aErr.message}`);
  const allowedIds = new Set((allowed ?? []).map((a) => a.user_id as string));

  let started = 0;
  for (const { row, period } of due) {
    if (started >= (opts.limit ?? 10)) break;
    const base = { order_id: row.id, user_id: row.user_id, period };
    if (!allowedIds.has(row.user_id)) {
      runs.push({ ...base, status: "skipped", reason: "not_allowed" });
      continue;
    }
    const budget = await budgetStatus(deps, row.user_id).catch(() => null);
    if (budget?.exceeded) {
      runs.push({ ...base, status: "skipped", reason: "budget_exceeded" });
      continue;
    }
    // The claim: only one caller moves last_period from its old value to this period.
    let claim = svc.from("agent_standing_orders").update({ last_period: period }).eq("id", row.id).eq("user_id", row.user_id);
    claim = row.last_period === null ? claim.is("last_period", null) : claim.eq("last_period", row.last_period);
    const { data: won } = await claim.select("id");
    if (!won?.length) continue;
    started++;
    const auth: AuthContext = { userId: row.user_id, mode: "api_token", client: svc };
    try {
      const job = await createJob(auth, {
        prompt: row.prompt,
        title: row.title,
        ...(row.skill ? { skill: row.skill as never } : {}),
        autonomy: row.autonomy as never,
        origin: "standing",
        standing_order_id: row.id,
      });
      await runJob(deps, auth, job.id);
      runs.push({ ...base, status: "started", job_id: job.id });
    } catch (err) {
      deps.log.error(`cron agent order ${row.id}`, err);
      runs.push({ ...base, status: "skipped", reason: err instanceof Error ? err.message.slice(0, 200) : "error" });
    }
  }
  return { ok: true, checked: data?.length ?? 0, runs };
}
