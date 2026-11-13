import { describe, expect, it } from "vitest";
import type { ActionItem } from "@/lib/mock/views";
import { buildExport, taskToExport } from "./tasks-export";

const task: ActionItem = {
  id: "a1",
  title: "Folien senden",
  tag: "",
  due: "2026-11-05",
  priority: "high",
  done: false,
  ai: true,
  assignee: "Me",
  sourceId: "",
  sourceKind: "note",
  timeframe: "this_week",
  context: "Vom Sync",
};

describe("tasks export", () => {
  it("maps a task with its project title", () => {
    expect(taskToExport(task, "Kortex")).toMatchObject({
      title: "Folien senden",
      project: "Kortex",
      timeframe: "this_week",
      due: "2026-11-05",
    });
  });

  it("clipboard is a bare checklist, markdown a headed file, csv a BOM file", () => {
    const t = [taskToExport(task, "Kortex")];
    const clip = buildExport("clipboard", t, "2026-11-01");
    expect(clip.file).toBeUndefined();
    expect(clip.text).toBe(
      "- [ ] Folien senden · Projekt: [[Kortex]] · Zeitrahmen: diese Woche · Fällig: 2026-11-05 · Kontext: Vom Sync\n",
    );
    const md = buildExport("markdown", t, "2026-11-01");
    expect(md.text.startsWith("# Kortex Tasks 2026-11-01\n\n- [ ]")).toBe(true);
    expect(md.file?.name).toBe("kortex-tasks-2026-11-01.md");
    const csv = buildExport("csv", t, "2026-11-01");
    expect(csv.text.startsWith("﻿title,status")).toBe(true);
    expect(csv.file?.name).toBe("kortex-tasks-2026-11-01.csv");
  });
});
