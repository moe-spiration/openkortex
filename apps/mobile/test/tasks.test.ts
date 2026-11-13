import { describe, expect, it } from "vitest";
import type { TaskRow } from "../src/data/live";
import { applyTaskPatch, cleanTaskPatch, shareMessage, taskMeta, toExportTask } from "../src/data/tasks";

const task: TaskRow = {
  id: "a1",
  title: "Folien senden",
  status: "open",
  priority: "high",
  due_date: "2026-11-05T00:00:00Z",
  source_item_id: null,
  created_at: "",
  timeframe: "this_week",
  context: "Vom Sync",
};

describe("mobile rich tasks", () => {
  it("cleans a patch: timeframe normalised, context trimmed, empty values clear", () => {
    expect(cleanTaskPatch({ timeframe: "diese Woche", context: "  a   b " })).toEqual({ timeframe: "this_week", context: "a b" });
    expect(cleanTaskPatch({ timeframe: "", context: " ", project_item_id: "" })).toEqual({ timeframe: null, context: null, project_item_id: null });
    expect(() => cleanTaskPatch({ timeframe: "bald" })).toThrow();
  });

  it("applies a patch without touching other fields", () => {
    expect(applyTaskPatch(task, { project_item_id: "p1" })).toMatchObject({ title: "Folien senden", project_item_id: "p1", timeframe: "this_week" });
  });

  it("builds the share text as Markdown checklist or CSV", () => {
    const t = [toExportTask(task, "Kortex")];
    expect(shareMessage("markdown", t, "2026-11-01").message).toBe("- [ ] Folien senden · Projekt: [[Kortex]] · Zeitrahmen: diese Woche · Fällig: 2026-11-05 · Kontext: Vom Sync\n");
    const csv = shareMessage("csv", t, "2026-11-01");
    expect(csv.title).toBe("kortex-tasks-2026-11-01.csv");
    expect(csv.message.split("\r\n")[1]).toBe("Folien senden,open,high,Kortex,this_week,2026-11-05,Vom Sync,,");
  });

  it("describes project, timeframe and export state in one line", () => {
    expect(taskMeta({ ...task, exported_at: "2026-11-01T10:00:00Z" }, "Kortex")).toBe("Kortex · diese Woche · überführt");
    expect(taskMeta({ ...task, timeframe: null })).toBe("");
  });
});
