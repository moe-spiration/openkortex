import { describe, expect, it } from "vitest";
import { comingBack, mondayOf, newConnections, openLoops, risingTags, signalNotes, type SignalNote } from "../src/lib/weekSignals";

const monday = "2026-11-09";
const N = (id: string, date: string, tags: string[] = [], links: string[] = [], path?: string): SignalNote => ({ id, title: id, date, tags, links, path });

describe("week signals", () => {
  it("finds the monday across months", () => {
    expect(mondayOf("2026-11-12")).toBe(monday);
    expect(mondayOf("2026-11-09")).toBe(monday);
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });

  it("ranks rising tags and skips daily", () => {
    const notes = [N("a", "2026-11-10", ["ai", "daily"]), N("b", "2026-11-11", ["#ai", "fit"]), N("c", "2026-11-03", ["fit"]), N("d", "2026-11-12", ["fit"])];
    expect(risingTags(notes, monday)).toEqual([{ tag: "#ai", now: 2, before: 0 }, { tag: "#fit", now: 2, before: 1 }]);
  });

  it("lists open loops up to sunday, overdue first", () => {
    const loops = openLoops(
      [
        { id: "1", title: "late", due: "2026-11-05", done: false },
        { id: "2", title: "fri", due: "2026-11-13", done: false, sourceId: "e" },
        { id: "3", title: "next", due: "2026-11-20", done: false },
        { id: "4", title: "done", due: "2026-11-10", done: true },
      ],
      "2026-11-12",
      "2026-11-15",
    );
    expect(loops.map((l) => [l.id, l.overdue, l.sourceId])).toEqual([["1", true, null], ["2", false, "e"]]);
  });

  it("finds new connections once per pair, not from daily notes", () => {
    const notes = [N("a", "2026-11-11", [], ["b"]), N("b", "2026-11-10", [], ["a"]), N("d", "2026-11-12", [], ["a"], "10_Notes/Daily"), N("old", "2026-11-01", [], ["a"])];
    expect(newConnections(notes, monday)).toEqual([{ fromId: "a", from: "a", toId: "b", to: "b" }]);
  });

  it("collects what comes back this week", () => {
    const items = [{ id: "x", remindAt: "2026-11-14T08:00:00Z" }, { id: "y", remindAt: "2026-11-16T08:00:00Z" }, { id: "z", remindAt: "2026-11-10T08:00:00Z", archived: true }, { id: "w", remindAt: "2026-11-09T07:00:00Z" }];
    expect(comingBack(items, monday).map((i) => i.id)).toEqual(["w", "x"]);
  });

  it("maps entries to notes with resolved links", () => {
    const notes = signalNotes(
      [
        { id: "1", title: "Alpha", day: 0, content: "see [[Beta]] and [[Beta|b]] and [[Nope]]" },
        { id: "2", title: "Beta", day: 3 },
      ],
      (id) => (id === "1" ? ["ai"] : []),
      "2026-11-12",
    );
    expect(notes[0]).toMatchObject({ date: "2026-11-12", tags: ["ai"], links: ["2"] });
    expect(notes[1]!.date).toBe("2026-11-09");
  });
});
