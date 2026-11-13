import { FEATURES } from "@kortex/i18n";
import { describe, expect, it } from "vitest";
import { AGENT_ASSIGNEE, boardCounts, boardMeta, bucketOf, columnOf, digestText, doneRate, dropPatch, newDueDate, stageCounts, stageMeta, stageOf, stagePatch, weekSunday } from "./tasks-board";

// Thursday, 22 Oct 2026 (the prototype's day); the week runs Mon 19 to Sun 25.
const TODAY = "2026-10-22";

describe("tasks board", () => {
  it("buckets and columns", () => {
    expect(weekSunday(TODAY)).toBe("2026-10-25");
    expect(bucketOf("2026-10-21", TODAY)).toBe("overdue");
    expect(bucketOf("2026-10-22T09:30:00Z", TODAY)).toBe("today");
    expect(bucketOf("2026-10-25", TODAY)).toBe("week");
    expect(bucketOf("2026-10-26", TODAY)).toBe("later");
    expect(bucketOf(undefined, TODAY)).toBe("later");
    expect(columnOf({ due: "2026-10-20", done: false }, TODAY)).toBe("today");
    expect(columnOf({ due: "2026-10-30", done: false }, TODAY)).toBe("week");
    expect(columnOf({ done: false }, TODAY)).toBe("week");
    expect(columnOf({ due: "2026-10-20", done: true }, TODAY)).toBe("done");
  });

  it("drop patches change due date and done state like the prototype", () => {
    expect(dropPatch({ due: "2026-10-24", done: false }, "today", TODAY)).toEqual({ due: TODAY });
    expect(dropPatch({ due: "2026-10-20", done: false }, "today", TODAY)).toEqual({});
    expect(dropPatch({ done: false }, "today", TODAY)).toEqual({ due: TODAY });
    expect(dropPatch({ due: TODAY, done: false }, "week", TODAY)).toEqual({ due: "2026-10-23" });
    expect(dropPatch({ due: "2026-10-24", done: false }, "week", TODAY)).toEqual({});
    expect(dropPatch({ due: "2026-10-24", done: false }, "done", TODAY)).toEqual({ done: true });
    expect(dropPatch({ due: "2026-10-24", done: true }, "done", TODAY)).toEqual({});
    expect(dropPatch({ due: "2026-10-24", done: true }, "week", TODAY)).toEqual({ done: false });
    expect(dropPatch({ due: "2026-10-24", done: true }, "today", TODAY)).toEqual({ done: false, due: TODAY });
  });

  it("new task due choices", () => {
    expect(newDueDate("today", TODAY)).toBe(TODAY);
    expect(newDueDate("tomorrow", TODAY)).toBe("2026-10-23");
    expect(newDueDate("week", TODAY)).toBe("2026-10-25");
    expect(newDueDate("week", "2026-10-25")).toBe("2026-10-26");
  });

  it("meta line, rate and digest text from the tasks", () => {
    const tasks = [
      { due: "2026-10-21", done: false, sourceTitle: "Q4 Sync" },
      { due: TODAY, done: false, sourceTitle: "Q4 Sync" },
      { due: "2026-10-24", done: false, sourceTitle: "Buch" },
      { due: "2026-10-20", done: true, sourceTitle: "Buch" },
    ];
    const c = boardCounts(tasks, TODAY);
    expect(boardMeta(c)).toBe("2 offen für heute, 1 für diese Woche, 1 erledigt. 1 überfällig.");
    expect(doneRate(c)).toBe(25);
    expect(digestText(tasks, TODAY)).toBe("Diese Woche sind 4 Aufgaben fällig, 1 davon erledigt. Die meisten offenen Aufgaben kommen aus „Q4 Sync“.");
    expect(boardMeta(boardCounts([], TODAY))).toBe("0 offen für heute, 0 für diese Woche, 0 erledigt.");
    expect(digestText([], TODAY)).toBe("Diese Woche ist keine Aufgabe fällig.");
  });
});

describe("status board", () => {
  const ai = { done: false, ai: true };
  const manual = { done: false, ai: false };

  it("derives the stage from what the task already carries", () => {
    expect(stageOf(ai)).toBe("suggested");
    expect(stageOf({ ...ai, accepted: true })).toBe("accepted");
    expect(stageOf(manual)).toBe("accepted");
    expect(stageOf({ ...ai, assignee: AGENT_ASSIGNEE })).toBe("agent");
    expect(stageOf({ ...manual, assignee: AGENT_ASSIGNEE, exportedAt: "2026-10-22T08:00:00Z" })).toBe("external");
    expect(stageOf({ ...ai, done: true, exportedAt: "2026-10-22T08:00:00Z" })).toBe("done");
  });

  it("patches only what a move changes", () => {
    expect(stagePatch(ai, "suggested")).toEqual({});
    expect(stagePatch(ai, "accepted")).toEqual({ accepted: true });
    expect(stagePatch({ ...ai, accepted: true }, "suggested")).toEqual({ accepted: false });
    expect(stagePatch(manual, "suggested")).toBeNull();
    expect(stagePatch(ai, "agent")).toEqual({ agent: true, accepted: true });
    expect(stagePatch(manual, "agent")).toEqual({ agent: true });
    expect(stagePatch({ ...manual, assignee: AGENT_ASSIGNEE }, "accepted")).toEqual({ agent: false });
    expect(stagePatch({ ...ai, accepted: true }, "external")).toEqual({ exported: true });
    expect(stagePatch({ ...manual, exportedAt: "2026-10-22T08:00:00Z" }, "accepted")).toEqual({ exported: false });
    expect(stagePatch(manual, "done")).toEqual({ done: true });
    expect(stagePatch({ ...manual, done: true }, "accepted")).toEqual({ done: false });
    expect(stagePatch({ ...ai, accepted: true, done: true }, "accepted")).toEqual({ done: false, accepted: true });
    expect(stagePatch({ ...ai, done: true }, "suggested")).toEqual({ done: false });
  });

  it("counts and words the head line", () => {
    const c = stageCounts([ai, ai, manual, { ...manual, done: true }, { ...manual, exportedAt: "x" }]);
    expect(c).toEqual({ suggested: 2, accepted: 1, agent: 0, external: 1, done: 1 });
    const initial = FEATURES.griply;
    FEATURES.griply = true;
    try {
      expect(stageMeta(c)).toBe("2 Vorschläge, 1 übernommen, 1 in Griply, 1 erledigt.");
    } finally {
      FEATURES.griply = initial;
    }
  });
});
