import { describe, expect, it } from "vitest";
import { comingBack, newConnections, openLoops, risingTags, type SignalNote } from "./week-signals";

const MONDAY = "2026-11-09";
const note = (id: string, date: string, tags: string[] = [], links: string[] = [], path = `10_Notes/${id}.md`): SignalNote => ({ id, title: `Titel ${id}`, date, tags, links, path });

describe("risingTags", () => {
  it("lists tags used more than the week before, biggest rise first, without #daily", () => {
    const notes = [
      note("a", "2026-11-10", ["#ai/mcp", "daily"]),
      note("b", "2026-11-11", ["ai/mcp", "#hosting"]),
      note("c", "2026-11-12", ["#ai/mcp", "#hosting", "#same"]),
      note("d", "2026-11-03", ["#hosting", "#same", "#gone"]),
      note("e", "2026-10-20", ["#ai/mcp"]),
    ];
    expect(risingTags(notes, MONDAY)).toEqual([
      { tag: "#ai/mcp", now: 3, before: 0 },
      { tag: "#hosting", now: 2, before: 1 },
    ]);
  });
});

describe("openLoops", () => {
  it("keeps open tasks due this week or earlier, the longest overdue first", () => {
    const tasks = [
      { id: "1", title: "B", due: "2026-11-12", done: false },
      { id: "2", title: "A", due: "2026-11-01", done: false, sourceId: "n1" },
      { id: "3", title: "C", due: "2026-11-20", done: false },
      { id: "4", title: "D", due: "2026-11-02", done: true },
    ];
    expect(openLoops(tasks, "2026-11-12", "2026-11-15")).toEqual([
      { id: "2", title: "A", due: "2026-11-01", overdue: true, sourceId: "n1" },
      { id: "1", title: "B", due: "2026-11-12", overdue: false, sourceId: null },
    ]);
  });
});

describe("newConnections", () => {
  it("pairs this week's entries with what they link to, each pair once", () => {
    const notes = [
      note("a", "2026-11-10", [], ["b", "x", "a"]),
      note("b", "2026-11-11", [], ["a", "old"]),
      note("old", "2026-09-01", [], ["a"]),
      note("day", "2026-11-12", [], ["a"], "10_Notes/Daily/2026-11-12.md"),
    ];
    expect(newConnections(notes, MONDAY)).toEqual([
      { fromId: "b", from: "Titel b", toId: "a", to: "Titel a" },
      { fromId: "b", from: "Titel b", toId: "old", to: "Titel old" },
    ]);
  });
});

describe("comingBack", () => {
  it("keeps reminders inside the week, earliest first", () => {
    const items = [
      { id: "1", remindAt: "2026-11-14T08:00:00.000Z" },
      { id: "2", remindAt: "2026-11-09T08:00:00.000Z" },
      { id: "3", remindAt: "2026-11-16T08:00:00.000Z" },
      { id: "4", remindAt: "2026-11-10T08:00:00.000Z", status: "archived" },
      { id: "5", remindAt: null },
    ];
    expect(comingBack(items, MONDAY).map((i) => i.id)).toEqual(["2", "1"]);
  });
});
