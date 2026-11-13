import { todayIso } from "@/lib/date/today";

/*
 * N5 #11: "today" is the workspace's calendar day (todayIso: Europe/Berlin live, the frozen mock day
 * in mock mode), not the browser's, and it is re-evaluated: when the tab becomes visible again or
 * gets focus, and at the next workspace midnight. A tab left open overnight writes to the right
 * `Daily/<date>.md`.
 */

const DAY_MS = 25 * 60 * 60 * 1000; // a calendar day is at most 25 h long (DST)

/**
 * Milliseconds from `now` until `today` returns a different day, or null when it does not change
 * within 25 h (mock mode). Binary search, so it works for any time zone and DST switch.
 */
export function msUntilNextDay(now: Date, today: (d: Date) => string = todayIso): number | null {
  const start = today(now);
  const t0 = now.getTime();
  if (today(new Date(t0 + DAY_MS)) === start) return null;
  let lo = 0;
  let hi = DAY_MS;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (today(new Date(t0 + mid)) === start) lo = mid;
    else hi = mid;
  }
  return hi;
}

export interface WatchTodayDeps {
  now?: () => Date;
  today?: (d: Date) => string;
  doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  win?: Pick<Window, "addEventListener" | "removeEventListener">;
}

/**
 * Calls `onDay` with the workspace day whenever it changes (visible again, focus, midnight).
 * Returns the unsubscribe function.
 */
export function watchToday(onDay: (iso: string) => void, deps: WatchTodayDeps = {}): () => void {
  const now = deps.now ?? (() => new Date());
  const today = deps.today ?? todayIso;
  const doc = deps.doc ?? document;
  const win = deps.win ?? window;
  let current = today(now());
  let timer: ReturnType<typeof setTimeout> | null = null;

  const check = () => {
    const d = today(now());
    if (d !== current) {
      current = d;
      onDay(d);
    }
    schedule();
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    const ms = msUntilNextDay(now(), today);
    // Background tabs throttle timers; visibility and focus catch up after that.
    timer = ms === null ? null : setTimeout(check, ms + 1000);
  };
  const onVisible = () => {
    if (doc.visibilityState === "visible") check();
  };

  doc.addEventListener("visibilitychange", onVisible);
  win.addEventListener("focus", check);
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
    doc.removeEventListener("visibilitychange", onVisible);
    win.removeEventListener("focus", check);
  };
}
