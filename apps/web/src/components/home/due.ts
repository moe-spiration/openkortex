import { isDueOn } from "@/lib/reminders";

/* "Heute fällig" (S11): items whose reminder has come (due today or overdue) and open tasks due today or earlier. */

export interface DueItemLike {
  id: string;
  title: string;
  type: string;
  remindAt?: string | null;
  status?: string;
}

export interface DueTaskLike {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  due: string;
  done: boolean;
  sourceId?: string;
}

export interface DueToday<I, T> {
  reminders: I[];
  tasks: T[];
}

const HIDDEN = new Set(["archived", "error"]);

export function dueToday<I extends DueItemLike, T extends DueTaskLike>(
  items: readonly I[],
  tasks: readonly T[],
  day: string,
  timeZone?: string,
): DueToday<I, T> {
  const reminders = items
    .filter((i) => !HIDDEN.has(i.status ?? "") && isDueOn(i.remindAt, day, timeZone))
    .sort((a, b) => Date.parse(a.remindAt!) - Date.parse(b.remindAt!));
  const open = tasks.filter((t) => !t.done && !!t.due && t.due <= day).sort((a, b) => a.due.localeCompare(b.due));
  return { reminders, tasks: open };
}
