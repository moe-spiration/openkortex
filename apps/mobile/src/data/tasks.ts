import { normalizeTimeframe, tasksToCsv, tasksToMarkdown, timeframeLabel, TIMEFRAMES, type ExportTask } from "@kortex/db/tasks";
import { PRODUCT_NAME, feature, t } from "../i18n";
import type { TaskRow } from "./live";

/*
 * Rich tasks on mobile (project, timeframe, context, "überführt"): pure helpers, no I/O.
 * Export goes through the system share sheet (react-native `Share`, text only), see docs/tasks-export.md.
 */

export { TIMEFRAMES, timeframeLabel };

export interface TaskPatch {
  project_item_id?: string | null;
  timeframe?: string | null;
  context?: string | null;
  /** YYYY-MM-DD or null (daily stack: "Morgen"). */
  due_date?: string | null;
}

/** Validated patch as it is written to action_items; throws on an invalid timeframe. */
export function cleanTaskPatch(p: TaskPatch): TaskPatch {
  const out: TaskPatch = {};
  if (p.project_item_id !== undefined) out.project_item_id = p.project_item_id || null;
  if (p.timeframe !== undefined) {
    const tf = p.timeframe ? normalizeTimeframe(p.timeframe) : null;
    if (p.timeframe && !tf) throw new Error(t("Invalid timeframe"));
    out.timeframe = tf;
  }
  if (p.context !== undefined) out.context = p.context?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  if (p.due_date !== undefined) {
    if (p.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.due_date)) throw new Error(t("Invalid date"));
    out.due_date = p.due_date || null;
  }
  return out;
}

export const applyTaskPatch = (task: TaskRow, p: TaskPatch): TaskRow => ({ ...task, ...cleanTaskPatch(p) });

export function toExportTask(t: TaskRow, projectTitle?: string): ExportTask {
  return {
    title: t.title,
    done: t.status === "done",
    priority: t.priority,
    due: t.due_date,
    timeframe: t.timeframe,
    context: t.context,
    project: projectTitle ?? null,
    externalRef: t.external_ref,
  };
}

export type ShareFormat = "markdown" | "csv";

/** Text handed to the share sheet; the title doubles as the file-name hint of receiving apps. */
export function shareMessage(format: ShareFormat, tasks: readonly ExportTask[], today: string): { title: string; message: string } {
  return format === "csv"
    ? { title: `kortex-tasks-${today}.csv`, message: tasksToCsv(tasks) }
    : { title: `${PRODUCT_NAME} Tasks ${today}`, message: tasksToMarkdown(tasks) };
}

/** Second line of a task row: project, timeframe and the "überführt" mark. */
export function taskMeta(task: TaskRow, projectTitle?: string): string {
  return [projectTitle, timeframeLabel(task.timeframe), task.exported_at ? t("handed over") : ""].filter(Boolean).join(" · ");
}

/*
 * Status board (like the web tasks hub): where a task stands between "Kortex suggests it" and "done", derived
 * from columns it already has: suggested (found by the AI, status open), accepted (typed by hand or taken over,
 * status in_progress), agent (assignee "Agent"), external (handed to Griply, exported_at), done.
 */
export type Stage = "suggested" | "accepted" | "agent" | "external" | "done";
export const STAGES: readonly Stage[] = ["suggested", "accepted", "agent", "external", "done"];
export const AGENT_ASSIGNEE = "Agent";
const MANUAL_TASK_MARK = "manual";

export function stageLabel(s: Stage): string {
  switch (s) {
    case "suggested":
      return t("Suggestions");
    case "accepted":
      return t("Taken over");
    case "agent":
      return t("With the agent");
    case "external":
      return feature("griply") ? t("In Griply") : t("Handed over");
    case "done":
      return t("Done");
  }
}

const isAi = (task: TaskRow) => !!task.source_item_id && task.description !== MANUAL_TASK_MARK;

export function stageOf(task: TaskRow): Stage {
  if (task.status === "done") return "done";
  if (task.exported_at) return "external";
  if (task.assignee === AGENT_ASSIGNEE) return "agent";
  return isAi(task) && task.status !== "in_progress" ? "suggested" : "accepted";
}

/** The row fields a move into `to` changes; null when the move is not possible (only AI tasks can be suggestions). */
export interface StageUpdate {
  status?: "open" | "in_progress" | "done";
  assignee?: string;
  exported?: boolean;
}
export function stageUpdate(task: TaskRow, to: Stage): StageUpdate | null {
  const from = stageOf(task);
  if (from === to) return {};
  if (to === "suggested" && !isAi(task)) return null;
  if (to === "done") return { status: "done" };
  const out: StageUpdate = {};
  if (!!task.exported_at !== (to === "external")) out.exported = to === "external";
  if ((task.assignee === AGENT_ASSIGNEE) !== (to === "agent")) out.assignee = to === "agent" ? AGENT_ASSIGNEE : "Me";
  const status = to === "suggested" ? "open" : isAi(task) ? "in_progress" : "open";
  if (task.status !== status) out.status = status;
  return out;
}
