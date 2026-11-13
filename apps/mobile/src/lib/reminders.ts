import { hasUnseenChange, parseWatch, type WatchState } from "@kortex/db/radar";
import { intlLocale, t } from "../i18n";

/*
 * Erinnerungen sheet (Home bell, mirrors the web page /erinnerungen): "Fällig" (reminder up to the end of
 * today or overdue), "Demnächst" (later reminders) and "Beobachtet" (pages the delta radar watches, unseen
 * changes first). Phone time, pure, tested without React Native.
 */

export interface ReminderEntryLike {
  id: string;
  remindAt?: string | null;
  meta?: Record<string, unknown>;
}

export interface Watched<E> {
  entry: E;
  watch: WatchState;
  unseen: boolean;
}

export interface ReminderGroups<E> {
  due: E[];
  upcoming: E[];
  watched: Watched<E>[];
}

const endOfDay = (now: Date) => {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

export function reminderGroups<E extends ReminderEntryLike>(entries: readonly E[], now: Date): ReminderGroups<E> {
  const end = endOfDay(now);
  const ms = (e: E) => Date.parse(e.remindAt ?? "");
  const timed = entries.filter((e) => !Number.isNaN(ms(e))).sort((a, b) => ms(a) - ms(b));
  const stamp = (w: WatchState) => Date.parse(w.last_diff?.at ?? w.last_checked_at ?? "") || 0;
  const watched = entries
    .map((entry) => ({ entry, watch: parseWatch(entry.meta) }))
    .filter((x): x is { entry: E; watch: WatchState } => !!x.watch?.enabled)
    .map((x) => ({ ...x, unseen: hasUnseenChange(x.watch) }))
    .sort((a, b) => Number(b.unseen) - Number(a.unseen) || stamp(b.watch) - stamp(a.watch));
  return { due: timed.filter((e) => ms(e) <= end), upcoming: timed.filter((e) => ms(e) > end), watched };
}

/** Number on the Home bell: what wants attention now (due reminders and unseen page changes). */
export function attentionCount(g: ReminderGroups<unknown>): number {
  return g.due.length + g.watched.filter((w) => w.unseen).length;
}

const fmt = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Second line of a watched page: blocked, last change, last check, or not checked yet. */
export function watchLine(w: WatchState): string {
  const every = w.interval === "weekly" ? t("weekly") : t("daily");
  if (w.status === "nicht beobachtbar") return w.reason ? t("Not watchable: {reason}", { reason: w.reason }) : t("Not watchable");
  if (w.last_diff) return t("Changed {when} · {every}", { when: fmt(w.last_diff.at), every });
  if (w.last_checked_at) return t("Checked {when}, no change · {every}", { when: fmt(w.last_checked_at), every });
  return t("Not checked yet · {every}", { every });
}

/** "Fällig seit …" / "Am …" for a reminder row. */
export function remindLine(iso: string, now: Date): string {
  return Date.parse(iso) <= now.getTime() ? t("Due since {when}", { when: fmt(iso) }) : t("On {when}", { when: fmt(iso) });
}
