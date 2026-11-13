import { describe, expect, it } from "vitest";
import { stageOf, stageUpdate } from "../src/data/tasks";
import type { TaskRow } from "../src/data/live";

const T = (over: Partial<TaskRow> = {}): TaskRow => ({ id: "t", title: "x", status: "open", priority: "medium", due_date: null, source_item_id: null, created_at: "", ...over });

describe("task stages", () => {
  it("derives the stage like the web board", () => {
    expect(stageOf(T({ source_item_id: "i" }))).toBe("suggested");
    expect(stageOf(T({ source_item_id: "i", description: "manual" }))).toBe("accepted");
    expect(stageOf(T())).toBe("accepted");
    expect(stageOf(T({ source_item_id: "i", status: "in_progress" }))).toBe("accepted");
    expect(stageOf(T({ assignee: "Agent" }))).toBe("agent");
    expect(stageOf(T({ exported_at: "2026-11-12" }))).toBe("external");
    expect(stageOf(T({ status: "done", exported_at: "x" }))).toBe("done");
  });
  it("computes the fields a move changes", () => {
    expect(stageUpdate(T({ source_item_id: "i" }), "accepted")).toEqual({ status: "in_progress" });
    expect(stageUpdate(T({ source_item_id: "i", status: "in_progress" }), "suggested")).toEqual({ status: "open" });
    expect(stageUpdate(T(), "suggested")).toBeNull();
    expect(stageUpdate(T(), "agent")).toEqual({ assignee: "Agent" });
    expect(stageUpdate(T({ assignee: "Agent" }), "accepted")).toEqual({ assignee: "Me" });
    expect(stageUpdate(T({ status: "done" }), "accepted")).toEqual({ status: "open" });
    expect(stageUpdate(T(), "done")).toEqual({ status: "done" });
    expect(stageUpdate(T(), "accepted")).toEqual({});
  });
});

describe("stage label without Griply (open-source edition)", () => {
  it("calls the handed-over stage neutral when the switch is off", async () => {
    const { FEATURES } = await import("@kortex/i18n");
    const { stageLabel } = await import("../src/data/tasks");
    const initial = FEATURES.griply;
    try {
      FEATURES.griply = true;
      expect(stageLabel("external")).toBe("In Griply");
      FEATURES.griply = false;
      expect(stageLabel("external")).toBe("Überführt");
    } finally {
      FEATURES.griply = initial;
    }
  });
});
