import { isLiveData, isoToday, MOCK_TODAY } from "@/lib/workspace-data";

/*
 * One "today" for every page (QA 2026-10-24: Home showed the real date while Journal and Insights
 * showed the mock day). Live: the real calendar day in Europe/Berlin (the zone the snapshot and the
 * server actions use). Mock: the prototype's frozen day (MOCK_TODAY, 2026-10-22), so the mock data
 * (meetings "heute", due dates, the journal) stays consistent with the headers.
 */

/** Today as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return isLiveData() ? isoToday(undefined, now) : MOCK_TODAY;
}

/**
 * Today as a local Date: the workspace's calendar day with the current time of day (greeting,
 * date headers). In live mode this is simply `now`.
 */
export function todayDate(now: Date = new Date()): Date {
  if (isLiveData()) return now;
  const [y, m, d] = todayIso(now).split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
}
