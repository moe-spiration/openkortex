import { isConfigured, loadDueReminders, loadRemindersUntil, loadTasks } from "../api/kortex";
import type { TaskRow } from "../data/live";
import type { DueItem } from "../notify/plan";
import { buildToday, endOfDay, mergeDue, rowsFor, type TodayModel } from "./model";

/** What the "Heute" widget shows, read with the stored session (works in the headless widget task too). */
export interface TodayData {
  due: DueItem[];
  tasks: TaskRow[];
  /** Both reads failed (offline, signed out). */
  error: boolean;
}

export async function loadTodayData(): Promise<TodayData> {
  if (!isConfigured()) return { due: [], tasks: [], error: true };
  const [due, later, tasks] = await Promise.allSettled([loadDueReminders(), loadRemindersUntil(endOfDay(new Date()).toISOString()), loadTasks()]);
  const dueOk = due.status === "fulfilled" || later.status === "fulfilled";
  return {
    due: mergeDue(due.status === "fulfilled" ? due.value : [], later.status === "fulfilled" ? later.value : []),
    tasks: tasks.status === "fulfilled" ? tasks.value : [],
    error: !dueOk && tasks.status === "rejected",
  };
}

export const todayModel = (data: TodayData, heightDp: number): TodayModel | null =>
  data.error ? null : buildToday(data.due, data.tasks, new Date(), rowsFor(heightDp));
