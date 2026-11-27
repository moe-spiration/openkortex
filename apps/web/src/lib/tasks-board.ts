/*
 * Tasks hub board logic (Feinschliff Live, Tasks): due buckets, the Heute / Diese Woche / Erledigt columns, the due date
 * a card gets when it is dragged into a column, the head line and the Weekly Digest numbers. Pure, so it is unit-tested.
 */

import { feature, t, tn, tx } from "@/i18n";

const DAY = 864e5;
const pad = (n: number) => String(n).padStart(2, "0");

/** Day number of an ISO day (UTC noon, so DST never shifts it). */
export const dayNum = (iso: string) => Math.floor(new Date(iso.slice(0, 10) + "T12:00:00Z").getTime() / DAY);
const isoOf = (n: number) => {
  const d = new Date(n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const addDay = (iso: string, n: number) => isoOf(dayNum(iso) + n);
/** Monday of the ISO week of a day. */
export const weekMonday = (iso: string) => addDay(iso, -((new Date(iso.slice(0, 10) + "T12:00:00Z").getUTCDay() + 6) % 7));
/** Sunday of the ISO week of a day. */
export const weekSunday = (iso: string) => addDay(weekMonday(iso), 6);

export type DueBucket = "overdue" | "today" | "week" | "later";
export type ColumnKey = "today" | "week" | "done";
export const COLUMN_LABEL: Record<ColumnKey, string> = {
  get today() {
    return t("Today");
  },
  get week() {
    return t("This week");
  },
  get done() {
    return t("Done");
  },
};

/** Where an open task falls relative to today; no due date counts as "later". */
export function bucketOf(due: string | undefined, today: string): DueBucket {
  if (!due) return "later";
  const n = dayNum(due);
  const now = dayNum(today);
  if (n < now) return "overdue";
  if (n === now) return "today";
  return n <= dayNum(weekSunday(today)) ? "week" : "later";
}

/** Board column: done → Erledigt; overdue and today → Heute; the rest (this week, later, no date) → Diese Woche. */
export function columnOf(task: { due?: string; done: boolean }, today: string): ColumnKey {
  if (task.done) return "done";
  const b = bucketOf(task.due, today);
  return b === "overdue" || b === "today" ? "today" : "week";
}

/**
 * What a drop into a column changes. Heute: due today unless the task is already due today or overdue.
 * Diese Woche: due tomorrow when it is due today / overdue / undated, otherwise unchanged. Erledigt: done.
 * Leaving Erledigt reopens the task. `due` is only set when it changes.
 */
export function dropPatch(t: { due?: string; done: boolean }, col: ColumnKey, today: string): { done?: boolean; due?: string } {
  if (col === "done") return t.done ? {} : { done: true };
  const out: { done?: boolean; due?: string } = t.done ? { done: false } : {};
  const b = bucketOf(t.due, today);
  if (col === "today" && (!t.due || (b !== "today" && b !== "overdue"))) out.due = today;
  if (col === "week" && (!t.due || b === "today" || b === "overdue")) out.due = addDay(today, 1);
  return out;
}

export type NewDue = "today" | "tomorrow" | "week";
export const NEW_DUE_LABEL: Record<NewDue, string> = {
  get today() {
    return t("Today");
  },
  get tomorrow() {
    return t("Tomorrow");
  },
  get week() {
    return t("This week");
  },
};

/** Due date of a new task from the Heute / Morgen / Diese Woche choice ("Diese Woche" = Sunday, at least tomorrow). */
export function newDueDate(choice: NewDue, today: string): string {
  if (choice === "today") return today;
  if (choice === "tomorrow") return addDay(today, 1);
  const sun = weekSunday(today);
  return sun === today ? addDay(today, 1) : sun;
}

export interface BoardCounts {
  today: number;
  week: number;
  done: number;
  overdue: number;
  total: number;
}

export function boardCounts(tasks: readonly { due?: string; done: boolean }[], today: string): BoardCounts {
  const c: BoardCounts = { today: 0, week: 0, done: 0, overdue: 0, total: tasks.length };
  for (const t of tasks) {
    c[columnOf(t, today)]++;
    if (!t.done && bucketOf(t.due, today) === "overdue") c.overdue++;
  }
  return c;
}

/** Head line: "6 offen für heute, 5 für diese Woche, 2 erledigt. 1 überfällig." */
export function boardMeta(c: BoardCounts): string {
  return t("{today} open for today, {week} for this week, {done} done.", { today: c.today, week: c.week, done: c.done }) + (c.overdue ? " " + t("{n} overdue.", { n: c.overdue }) : "");
}

/** Share of done tasks in percent (0 when there are none). */
export const doneRate = (c: BoardCounts) => (c.total ? Math.round((100 * c.done) / c.total) : 0);

/**
 * Digest sentence from the real tasks: what falls due in the current week and how much of it is done, plus the
 * sources most open tasks come from (only sources with at least two open tasks are named).
 */
export function digestText(
  tasks: readonly { due?: string; done: boolean; sourceTitle?: string }[],
  today: string,
): string {
  const from = dayNum(weekMonday(today));
  const to = from + 6;
  const inWeek = tasks.filter((x) => x.due && dayNum(x.due) >= from && dayNum(x.due) <= to);
  const doneInWeek = inWeek.filter((x) => x.done).length;
  const parts: string[] = [];
  parts.push(
    inWeek.length
      ? tn(inWeek.length, "{n} task is due this week, {done} of them done.", "{n} tasks are due this week, {done} of them done.", { done: doneInWeek })
      : t("No task is due this week."),
  );
  const bySource = new Map<string, number>();
  for (const x of tasks) if (!x.done && x.sourceTitle) bySource.set(x.sourceTitle, (bySource.get(x.sourceTitle) ?? 0) + 1);
  const top = [...bySource.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2);
  if (top.length) parts.push(t("Most open tasks come from {sources}.", { sources: top.map(([s]) => t("“{title}”", { title: s })).join(` ${t("and")} `) }));
  return parts.join(" ");
}

/*
 * Status board: where a task stands between "Kortex suggests it" and "done". Derived from columns the
 * tasks already have, so no extra state is stored:
 *   suggested  extracted by the AI and not taken over yet (status open)
 *   accepted   typed by hand, or taken over (status in_progress)
 *   agent      handed to the agent (assignee "Agent")
 *   external   handed over to the task tool, e.g. Griply (exported_at); read only here
 *   done       status done
 */
export type Stage = "suggested" | "accepted" | "agent" | "external" | "done";
export const STAGES: readonly Stage[] = ["suggested", "accepted", "agent", "external", "done"];
/** `action_items.assignee` of a task the agent works on. */
export const AGENT_ASSIGNEE = "Agent";
export const STAGE_LABEL: Record<Stage, string> = {
  get suggested() {
    return t("Suggestions");
  },
  get accepted() {
    return t("Taken over");
  },
  get agent() {
    return t("With the agent");
  },
  get external() {
    return feature("griply") ? t("In Griply") : t("Handed over");
  },
  get done() {
    return t("Done");
  },
};

export interface StageTask {
  done: boolean;
  ai: boolean;
  accepted?: boolean;
  assignee?: string;
  exportedAt?: string;
}

export function stageOf(task: StageTask): Stage {
  if (task.done) return "done";
  if (task.exportedAt) return "external";
  if (task.assignee === AGENT_ASSIGNEE) return "agent";
  return task.ai && !task.accepted ? "suggested" : "accepted";
}

/** What moving a task into a stage changes; only the fields that change are set, null = the move is not possible. */
export interface StagePatch {
  done?: boolean;
  accepted?: boolean;
  agent?: boolean;
  exported?: boolean;
}

export function stagePatch(task: StageTask, to: Stage): StagePatch | null {
  const from = stageOf(task);
  if (from === to) return {};
  // Only what the AI found can go back to the suggestions.
  if (to === "suggested" && !task.ai) return null;
  const out: StagePatch = {};
  if (task.done) out.done = false;
  if (to === "done") return { done: true };
  if (!!task.exportedAt !== (to === "external")) out.exported = to === "external";
  if ((task.assignee === AGENT_ASSIGNEE) !== (to === "agent")) out.agent = to === "agent";
  // Leaving "done" resets the status to open, so "taken over" has to be set again.
  const accepted = to !== "suggested";
  if (task.ai && (!!task.accepted !== accepted || (task.done && accepted))) out.accepted = accepted;
  return out;
}

/** Tasks per stage, in board order. */
export function stageCounts(tasks: readonly StageTask[]): Record<Stage, number> {
  const c: Record<Stage, number> = { suggested: 0, accepted: 0, agent: 0, external: 0, done: 0 };
  for (const task of tasks) c[stageOf(task)]++;
  return c;
}

/** Head line of the status board: "4 Vorschläge, 3 übernommen, 1 beim Agenten, 2 in Griply, 5 erledigt." */
export function stageMeta(c: Record<Stage, number>): string {
  return [
    tn(c.suggested, "{n} suggestion", "{n} suggestions"),
    t("{n} taken over", { n: c.accepted }),
    ...(c.agent ? [t("{n} with the agent", { n: c.agent })] : []),
    ...(c.external ? [feature("griply") ? t("{n} in Griply", { n: c.external }) : t("{n} handed over", { n: c.external })] : []),
    t("{n} done", { n: c.done }),
  ].join(", ") + ".";
}

/*
 * Ruhe board (2026-11-27, screen "Aufgaben"): four columns Offen / Heute / In Arbeit / Erledigt. They sit on top of the
 * stages above, nothing new is stored: a suggestion, a taken-over task and a task handed to Griply stay what they are
 * and only fall into Offen or Heute by their due date; the card shows the stage as a mark ("Vorschlag", "Griply").
 *   open   not done, not with the agent, due later / this week / undated
 *   today  not done, not with the agent, due today or overdue
 *   doing  handed to the agent ("In Arbeit")
 *   done   done
 */
export type RuheColumn = "open" | "today" | "doing" | "done";
export const RUHE_COLUMNS: readonly RuheColumn[] = ["open", "today", "doing", "done"];
export const RUHE_COLUMN_LABEL: Record<RuheColumn, string> = {
  get open() {
    return tx("status", "Open");
  },
  get today() {
    return t("Today");
  },
  get doing() {
    return tx("task", "In progress");
  },
  get done() {
    return t("Done");
  },
};

export function ruheColumnOf(task: StageTask & { due?: string }, today: string): RuheColumn {
  const stage = stageOf(task);
  if (stage === "done") return "done";
  if (stage === "agent") return "doing";
  const b = bucketOf(task.due || undefined, today);
  return b === "today" || b === "overdue" ? "today" : "open";
}

/**
 * What a drop into a Ruhe column changes: the stage to move to (null = keep) and a new due date (only when it changes).
 * Heute: due today unless already due today / overdue. Offen: a task due today / overdue moves to tomorrow, an undated
 * one stays undated. Leaving Erledigt or the agent puts the task back to "taken over" (a task in Griply stays there).
 */
export function ruheDrop(task: StageTask & { due?: string }, col: RuheColumn, today: string): { stage: Stage | null; due?: string } {
  const from = ruheColumnOf(task, today);
  if (from === col) return { stage: null };
  if (col === "done") return { stage: "done" };
  if (col === "doing") return { stage: "agent" };
  const stage = stageOf(task);
  const back: Stage | null = stage === "done" || stage === "agent" ? (task.exportedAt ? "external" : "accepted") : null;
  const b = bucketOf(task.due || undefined, today);
  const due = col === "today" ? (b === "today" || b === "overdue" ? undefined : today) : b === "today" || b === "overdue" ? addDay(today, 1) : undefined;
  return due ? { stage: back, due } : { stage: back };
}
