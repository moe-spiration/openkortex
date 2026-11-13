import { tasksToCsv, tasksToMarkdown, type ExportTask } from "@kortex/db/tasks";
import type { ActionItem } from "@/lib/mock/views";
import { PRODUCT_NAME } from "@/i18n";

/*
 * Export of selected tasks (Tasks hub): Markdown checklist for the clipboard or a .md file, CSV file.
 * Pure; the view does the clipboard / download and then marks the tasks as exported ("überführt").
 */

const BOM = String.fromCharCode(0xfeff);

export type ExportFormat = "clipboard" | "markdown" | "csv";

export function taskToExport(t: ActionItem, projectTitle?: string): ExportTask {
  return {
    title: t.title,
    done: t.done,
    priority: t.priority,
    due: t.due || null,
    timeframe: t.timeframe ?? null,
    context: t.context ?? null,
    project: projectTitle ?? null,
    assignee: t.assignee,
    externalRef: t.externalRef ?? null,
  };
}

export interface BuiltExport {
  text: string;
  /** Set for file downloads. */
  file?: { name: string; mime: string };
}

export function buildExport(
  format: ExportFormat,
  tasks: readonly ExportTask[],
  today: string,
): BuiltExport {
  if (format === "csv") {
    // BOM so Excel reads umlauts as UTF-8.
    return {
      text: `${BOM}${tasksToCsv(tasks)}`,
      file: { name: `kortex-tasks-${today}.csv`, mime: "text/csv;charset=utf-8" },
    };
  }
  const text = tasksToMarkdown(
    tasks,
    format === "markdown" ? { title: `${PRODUCT_NAME} Tasks ${today}` } : {},
  );
  return format === "markdown"
    ? { text, file: { name: `kortex-tasks-${today}.md`, mime: "text/markdown;charset=utf-8" } }
    : { text };
}

/** Browser download of a text file (no server round trip). */
export function downloadText(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
