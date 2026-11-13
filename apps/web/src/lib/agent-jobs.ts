import { intlLocale, t } from "@/i18n";

/*
 * Agent jobs ("Aufträge") and standing orders ("Daueraufträge"): the shapes the pages use and the
 * pure rules (reading a standing order from a sentence, when one is due, how jobs are grouped).
 * The work itself runs on the server (server/agent). Covered by tests.
 */

export const JOB_STATUSES = ["queued", "running", "waiting", "done", "error", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobOrigin = "manual" | "standing" | "task" | "presort";
export type JobAutonomy = "read" | "ask" | "self";

export interface JobStep {
  kind: "search" | "read" | "write";
  label: string;
  count?: number;
}
export interface JobSource {
  n: number;
  item_id: string;
  title: string;
  type: string;
}
export interface JobActionResult {
  ok: boolean;
  label: string;
  item_id?: string;
  error?: string;
  /** What is needed to take the change back (opaque for the page). */
  undo?: unknown;
}

/** Outcome of a job, stored in kortex.agent_jobs.result. */
export interface JobResult {
  answer_md?: string;
  steps?: JobStep[];
  sources?: JobSource[];
  /** Changes waiting for confirmation (autonomy "ask"). `actions` are opaque for the page. */
  proposal?: { actions: unknown[]; labels: string[] };
  /** Changes carried out (autonomy "self", or after the confirmation). */
  done?: { results: JobActionResult[] };
  /** The carried-out changes were taken back. */
  undone?: boolean;
}

export interface JobView {
  id: string;
  title: string;
  prompt: string;
  skill: string | null;
  autonomy: JobAutonomy;
  status: JobStatus;
  origin: JobOrigin;
  actionItemId: string | null;
  result: JobResult | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface StandingOrderView {
  id: string;
  title: string;
  prompt: string;
  cadence: "daily" | "weekly";
  hour: number;
  /** ISO weekday 1 (Monday) to 7 (Sunday), weekly only. */
  weekday: number | null;
  autonomy: JobAutonomy;
  enabled: boolean;
  lastPeriod: string | null;
}

/** Title of a job from its request: one line, at most 80 characters. */
export function jobTitle(prompt: string): string {
  const line = prompt.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 78).trimEnd()} …` : line || "–";
}

const active = (s: JobStatus) => s === "queued" || s === "running";

/** The three groups of the job list: waiting for the user, running, finished (newest first). */
export function groupJobs(jobs: readonly JobView[]): { waiting: JobView[]; running: JobView[]; finished: JobView[] } {
  const newest = (a: JobView, b: JobView) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt);
  return {
    waiting: jobs.filter((j) => j.status === "waiting").sort(newest),
    running: jobs.filter((j) => active(j.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    finished: jobs.filter((j) => j.status === "done" || j.status === "error").sort(newest),
  };
}

export const hasActiveJobs = (jobs: readonly JobView[]) => jobs.some((j) => active(j.status));

/** A job that has been "running" this long was cut off (server restart): it counts as failed. */
export const JOB_STALE_MS = 15 * 60_000;
export function isStale(job: Pick<JobView, "status" | "startedAt" | "createdAt">, now: Date): boolean {
  if (!active(job.status)) return false;
  const since = Date.parse(job.startedAt ?? job.createdAt);
  return Number.isFinite(since) && now.getTime() - since > JOB_STALE_MS;
}

const NIGHT_WINDOW_MS = 18 * 3_600_000;

/**
 * "Über Nacht erledigt": what standing orders finished in the last 18 hours (done, or waiting for a
 * confirmation), newest first.
 */
export function overnightJobs(jobs: readonly JobView[], now: Date): JobView[] {
  return jobs
    .filter((j) => j.origin === "standing" && (j.status === "done" || j.status === "waiting") && !!j.finishedAt && now.getTime() - Date.parse(j.finishedAt) < NIGHT_WINDOW_MS)
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
}

// --- Standing orders -----------------------------------------------------------------------------

const WEEKDAYS: Array<[number, RegExp]> = [
  [1, /^(montags?|mondays?)\b/i],
  [2, /^(dienstags?|tuesdays?)\b/i],
  [3, /^(mittwochs?|wednesdays?)\b/i],
  [4, /^(donnerstags?|thursdays?)\b/i],
  [5, /^(freitags?|fridays?)\b/i],
  [6, /^(samstags?|sonnabends?|saturdays?)\b/i],
  [7, /^(sonntags?|sundays?)\b/i],
];
const EVERY = /^(jeden|jede|jedes|every|on|am|an jedem)\s+/i;
const DAILY = /^(jeden tag|täglich|taeglich|every day|daily)\b/i;
const MORNING = /^(jeden morgen|morgens|every morning|in the morning)\b/i;
const EVENING = /^(jeden abend|abends|every evening|in the evening)\b/i;
const HOUR = /^(?:um|at|gegen)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(uhr|am|pm|a\.m\.|p\.m\.|h)?/i;

export interface ParsedStandingOrder {
  cadence: "daily" | "weekly";
  hour: number;
  weekday: number | null;
  /** What the agent should do, without the schedule words. */
  prompt: string;
  /** The sentence as the user wrote it (shortened). */
  title: string;
}

/**
 * Reads a standing order from a sentence, in German or English: "Jeden Morgen um 6 Uhr den
 * Tagesstapel vorbereiten", "Sonntags um 18 Uhr Wochenrückblick entwerfen", "Every Friday summarize
 * my reading list". Null when the sentence names no schedule or nothing to do.
 */
export function parseStandingOrder(text: string): ParsedStandingOrder | null {
  const original = text.replace(/\s+/g, " ").trim();
  let rest = original;
  let cadence: "daily" | "weekly" | null = null;
  let weekday: number | null = null;
  let hour: number | null = null;
  const eat = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.slice(m[0].length).replace(/^[\s,:]+/, "");
    return m;
  };
  if (eat(MORNING)) [cadence, hour] = ["daily", 6];
  else if (eat(EVENING)) [cadence, hour] = ["daily", 18];
  else if (eat(DAILY)) cadence = "daily";
  else {
    const before = rest;
    eat(EVERY);
    const day = WEEKDAYS.find(([, re]) => re.test(rest));
    if (day) {
      eat(day[1]);
      [cadence, weekday] = ["weekly", day[0]];
    } else rest = before;
  }
  if (!cadence) return null;
  // "… morgens", "… abends" after a weekday.
  if (eat(/^(morgens|morgen|früh|in the morning|mornings?)\b/i)) hour = 6;
  else if (eat(/^(abends|abend|in the evening|evenings?)\b/i)) hour = 18;
  const at = eat(HOUR);
  if (at) {
    let h = Number(at[1]);
    const suffix = (at[3] ?? "").toLowerCase().replace(/\./g, "");
    if (suffix === "pm" && h < 12) h += 12;
    if (suffix === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) hour = h;
  }
  const prompt = rest.replace(/^(bitte|please)\s+/i, "").trim();
  if (prompt.length < 3) return null;
  return {
    cadence,
    hour: hour ?? 7,
    weekday,
    prompt: prompt.charAt(0).toUpperCase() + prompt.slice(1),
    title: jobTitle(original),
  };
}

/** "Täglich um 06:00" / "Sonntags um 18:00": when a standing order runs. */
export function scheduleLabel(order: Pick<StandingOrderView, "cadence" | "hour" | "weekday">): string {
  const hour = `${String(order.hour).padStart(2, "0")}:00`;
  if (order.cadence === "daily" || !order.weekday) return t("Daily at {hour}", { hour });
  // 2024-01-01 was a Monday.
  const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, order.weekday)));
  return t("Every {weekday} at {hour}", { weekday, hour });
}

/** The local moment a cron run looks at. `weekday` is ISO (1 Monday to 7 Sunday). */
export interface LocalMoment {
  /** YYYY-MM-DD */
  date: string;
  /** 2026-W46 */
  week: string;
  weekday: number;
  hour: number;
}

/**
 * The period a standing order should run for now, or null. Daily: once per day from its hour on;
 * weekly: once per week, on its weekday from its hour on. A period that already ran (`lastPeriod`)
 * does not run again.
 */
export function duePeriod(order: Pick<StandingOrderView, "cadence" | "hour" | "weekday" | "enabled" | "lastPeriod">, at: LocalMoment): string | null {
  if (!order.enabled || at.hour < order.hour) return null;
  if (order.cadence === "weekly" && order.weekday !== at.weekday) return null;
  const period = order.cadence === "daily" ? at.date : at.week;
  return order.lastPeriod === period ? null : period;
}
