import type { WatchState } from "@/lib/radar";

/*
 * Reminders and watched pages of the mock workspace (KORTEX_DATA_SOURCE=mock), so /reminders shows filled groups:
 * two due reminders (in the past, so due on any day), two upcoming ones (a few days after the real today, day
 * precision so server and browser agree) and two watched web pages, one with an unseen change.
 */

const inDays = (n: number) => `${new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)}T07:00:00.000Z`;

const watch = (w: Partial<WatchState>): WatchState => ({ enabled: true, interval: "daily", status: "ok", ...w });

export const MOCK_REMINDERS: Record<string, { remindAt?: string; watch?: WatchState }> = {
  n15: { remindAt: "2026-10-22T07:00:00.000Z" },
  n23: { remindAt: "2026-10-21T16:00:00.000Z" },
  n12: { remindAt: inDays(2) },
  n17: { remindAt: inDays(5) },
  n9: {
    watch: watch({
      last_checked_at: "2026-10-22T06:00:00.000Z",
      last_diff: {
        at: "2026-10-22T06:00:00.000Z",
        summary: "A new section on partner ecosystems; the build-or-buy matrix now weighs integration cost.",
        added: [],
        removed: [],
      },
    }),
  },
  n4: { watch: watch({ interval: "weekly", last_checked_at: "2026-10-20T06:00:00.000Z" }) },
};
