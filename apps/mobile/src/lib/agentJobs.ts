/*
 * Agent jobs ("Aufträge") and standing orders ("Daueraufträge") on the phone: the shapes of
 * GET /api/mobile/agent and the pure rules of apps/web/src/lib/agent-jobs.ts (grouping, "Über Nacht
 * erledigt", stale runs). The work runs on the server. Pure, covered by tests.
 */

export type JobStatus = "queued" | "running" | "waiting" | "done" | "error" | "cancelled";
export type JobOrigin = "manual" | "standing" | "task" | "presort";
export type JobAutonomy = "read" | "ask" | "self";

export interface JobActionResult {
  ok: boolean;
  label: string;
  item_id?: string;
  error?: string;
  undo?: unknown;
}
export interface JobResult {
  answer_md?: string;
  steps?: { kind: "search" | "read" | "write"; label: string; count?: number }[];
  sources?: { n: number; item_id: string; title: string; type: string }[];
  proposal?: { actions: unknown[]; labels: string[] };
  done?: { results: JobActionResult[] };
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
  weekday: number | null;
  autonomy: JobAutonomy;
  enabled: boolean;
  lastPeriod: string | null;
}

const active = (s: JobStatus) => s === "queued" || s === "running";
export const hasActiveJobs = (jobs: readonly JobView[]) => jobs.some((j) => active(j.status));

/** Waiting for the user, running, finished (newest first), like the web agent page. */
export function groupJobs(jobs: readonly JobView[]): { waiting: JobView[]; running: JobView[]; finished: JobView[] } {
  const newest = (a: JobView, b: JobView) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt);
  return {
    waiting: jobs.filter((j) => j.status === "waiting").sort(newest),
    running: jobs.filter((j) => active(j.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    finished: jobs.filter((j) => j.status === "done" || j.status === "error").sort(newest),
  };
}

/** A job "running" this long was cut off (server restart): it counts as failed. */
export const JOB_STALE_MS = 15 * 60_000;
export function isStale(job: Pick<JobView, "status" | "startedAt" | "createdAt">, now: Date): boolean {
  if (!active(job.status)) return false;
  const since = Date.parse(job.startedAt ?? job.createdAt);
  return Number.isFinite(since) && now.getTime() - since > JOB_STALE_MS;
}

const NIGHT_WINDOW_MS = 18 * 3_600_000;

/** "Über Nacht erledigt": what standing orders finished in the last 18 hours (done or waiting), newest first. */
export function overnightJobs(jobs: readonly JobView[], now: Date): JobView[] {
  return jobs
    .filter((j) => j.origin === "standing" && (j.status === "done" || j.status === "waiting") && !!j.finishedAt && now.getTime() - Date.parse(j.finishedAt) < NIGHT_WINDOW_MS)
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
}

/** Whether the text reads like a standing order ("Jeden Morgen …", "Sonntags um 18 …", "Every Friday …"); the server parses it. */
export function looksLikeStandingOrder(text: string): boolean {
  return /^(jeden|jede|jedes|täglich|taeglich|morgens|abends|every|daily|(mon|diens|mittwoch|donners|frei|sams|sonn)tags?|sonnabends?|(mon|tues|wednes|thurs|fri|satur|sun)days?)\b/i.test(text.trim());
}
