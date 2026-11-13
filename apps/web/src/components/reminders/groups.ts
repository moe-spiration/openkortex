import { hasUnseenChange, type WatchState } from "@/lib/radar";
import { isDueOn } from "@/lib/reminders";

/* Groups of the Erinnerungen page: due (today or overdue), upcoming, and watched pages (delta radar). */

export interface ReminderItemLike {
  id: string;
  title: string;
  status?: string;
  remindAt?: string | null;
  watch?: WatchState | null;
}

const HIDDEN = new Set(["archived", "error"]);

export interface ReminderGroups<T> {
  due: T[];
  upcoming: T[];
  /** Watched pages: unseen changes first, then the most recently changed or checked. */
  watched: T[];
}

export function groupReminders<T extends ReminderItemLike>(items: readonly T[], day: string, timeZone?: string): ReminderGroups<T> {
  const visible = items.filter((i) => !HIDDEN.has(i.status ?? ""));
  const withReminder = visible.filter((i) => !!i.remindAt && !Number.isNaN(Date.parse(i.remindAt)));
  const byTime = (a: T, b: T) => Date.parse(a.remindAt!) - Date.parse(b.remindAt!);
  const due = withReminder.filter((i) => isDueOn(i.remindAt, day, timeZone)).sort(byTime);
  const upcoming = withReminder.filter((i) => !isDueOn(i.remindAt, day, timeZone)).sort(byTime);
  const stamp = (i: T) => Date.parse(i.watch?.last_diff?.at ?? i.watch?.last_checked_at ?? "") || 0;
  const watched = visible
    .filter((i) => i.watch?.enabled)
    .sort((a, b) => Number(hasUnseenChange(b.watch)) - Number(hasUnseenChange(a.watch)) || stamp(b) - stamp(a));
  return { due, upcoming, watched };
}
