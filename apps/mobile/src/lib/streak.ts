import { addDays, currentStreak, todayIn } from "@kortex/db/daily";

/**
 * Check-in streak (W6/A-08): the shared rule from @kortex/db/daily, as on the web. Mobile has no
 * daily-note feed yet, so the mock days are the prototype's 14 days up to yesterday; saving today's
 * check-in adds today (14 → 15). Day boundary: midnight in the device's time zone.
 */
export function mockCheckinStreak(saved: boolean, now: Date = new Date()): number {
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, now);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, -(i + 1)));
  return currentStreak(saved ? [today, ...days] : days, today);
}
