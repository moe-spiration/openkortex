import { isoDay } from "../data/daily";
import { t } from "../i18n";
import { dueLabel, type TaskRow } from "../data/live";
import { entryLink, type DueItem } from "../notify/plan";

// Rows of the "Heute" widget: due reminders (and unseen radar changes) first, then open tasks due today or earlier.

export const WIDGET_CAPTURE = "KortexCapture";
export const WIDGET_TODAY = "KortexToday";

export interface TodayRow {
  key: string;
  title: string;
  /** Second line: time of the reminder, or the due label of the task. */
  meta: string;
  kind: "reminder" | "radar" | "task";
  /** Deep link a tap opens. */
  link: string;
}

export interface TodayModel {
  rows: TodayRow[];
  /** Due things that did not fit. */
  more: number;
  total: number;
}

const OPEN_APP = "kortex://open";
const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

/**
 * Local calendar day (YYYY-MM-DD) of a task's due_date. The column is timestamptz, so the API answers
 * "2026-11-04T09:00:00+00:00", which sorts after "2026-11-04" and never matched a plain string compare.
 * Date-only values and midnight-UTC stamps (a day without a time) keep their own date.
 */
export function dueDay(due: string): string {
  if (due.length <= 10 || /T00:00(:00(\.0+)?)?(Z|\+00(:?00)?)?$/.test(due)) return due.slice(0, 10);
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? due.slice(0, 10) : isoDay(d);
}

/** Open task that is due today, overdue or planned for "today". */
export const dueToday = (t: TaskRow, today: string): boolean =>
  (t.status === "open" || t.status === "in_progress") && ((!!t.due_date && dueDay(t.due_date) <= today) || t.timeframe === "today");

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** End of the local day, the cut-off of "Heute". */
export const endOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

/** Server list (already due, plus radar changes) and the reminders still coming today; one row per id, the server wins. */
export function mergeDue(server: readonly DueItem[], today: readonly DueItem[]): DueItem[] {
  const seen = new Set(server.map((d) => d.id));
  return [...server, ...today.filter((d) => !seen.has(d.id))];
}

export function buildToday(due: readonly DueItem[], tasks: readonly TaskRow[], now: Date, max: number): TodayModel {
  const today = isoDay(now);
  const all: TodayRow[] = [
    ...[...due]
      .sort((a, b) => Date.parse(a.remind_at) - Date.parse(b.remind_at))
      .map<TodayRow>((d) => ({
        key: d.id,
        title: d.title.trim() || t("Untitled"),
        meta: d.kind === "radar" ? t("Page changed") : t("Reminder · {time}", { time: clock(d.remind_at) }),
        kind: d.kind,
        link: entryLink(d.id),
      })),
    ...tasks
      .filter((task) => dueToday(task, today))
      .sort((a, b) => (a.due_date ? dueDay(a.due_date) : "9999").localeCompare(b.due_date ? dueDay(b.due_date) : "9999") || PRIORITY[a.priority] - PRIORITY[b.priority])
      .map<TodayRow>((task) => ({
        key: task.id,
        title: task.title,
        meta: dueLabel(task.due_date, now) ?? t("Today"),
        kind: "task",
        link: task.source_item_id ? entryLink(task.source_item_id) : OPEN_APP,
      })),
  ];
  const shown = Math.max(0, max);
  return { rows: all.slice(0, shown), more: Math.max(0, all.length - shown), total: all.length };
}

/** How many rows fit a widget of `heightDp` (header 44 dp, row 40 dp), 1 to 6. */
export const rowsFor = (heightDp: number) => Math.min(6, Math.max(1, Math.floor((heightDp - 44) / 40)));
