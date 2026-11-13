import { describe, expect, it } from "vitest";
import { buildStack, nextDay, parseStackState, STACK_MAX, type StackEntry, type StackTask } from "../src/lib/stack";

const now = new Date(2026, 10, 12, 10, 0);
const today = "2026-11-12";
const E = (id: string, over: Partial<StackEntry> = {}): StackEntry => ({ id, title: id, tldr: "", folder: "10_Notes", img: { uri: id }, day: 5, ...over });
const T = (id: string, due: string | null, status = "open"): StackTask => ({ id, title: id, status, due_date: due, source_item_id: null });

describe("buildStack", () => {
  it("orders tasks, reminders, inbox, filed, rediscover and flashcards", () => {
    const cards = buildStack({
      entries: [E("r", { remindAt: new Date(2026, 10, 12, 8).toISOString() }), E("i", { folder: "00_Inbox" }), E("f1", { day: 0, folder: "30_Clippings" }), E("f2", { day: 1, folder: "30_Clippings/Web" })],
      tasks: [T("late", "2026-11-10"), T("now", today), T("later", "2026-11-20"), T("done", today, "done")],
      home: { archive: { id: "a", title: "Alt", quote: "q", yearAgo: true }, flashcards: { itemId: "fc", deck: "MCP", cards: [["Q", "A"]] }, fitsToday: null },
      today,
      now,
      locale: "de-DE",
    });
    expect(cards.map((c) => c.id)).toEqual(["task:late", "task:now", "remind:r", "inbox:i", `filed:${today}`, "redis:a:a", "flash:MCP:Q"]);
    expect(cards.find((c) => c.kind === "filed")!.chips).toEqual(["Clippings · 2"]);
    expect(cards.at(-1)!.answer).toBe("A");
  });

  it("skips future reminders, failed entries and a single filed entry; caps the deck", () => {
    const cards = buildStack({
      entries: [E("future", { remindAt: new Date(2026, 10, 14).toISOString() }), E("bad", { folder: "00_Inbox", error: "x" }), E("one", { day: 0 })],
      tasks: Array.from({ length: 12 }, (_, i) => T(`t${i}`, today)),
      home: null,
      today,
      now,
      locale: "de-DE",
    });
    expect(cards.every((c) => c.kind === "task")).toBe(true);
    expect(cards.length).toBeLessThanOrEqual(STACK_MAX);
    expect(cards).toHaveLength(3);
  });
});

describe("stack state", () => {
  it("keeps only today's outcomes", () => {
    expect(parseStackState(JSON.stringify({ day: today, done: { a: "done", b: "aside", c: "x" } }), today)).toEqual({ a: "done", b: "aside" });
    expect(parseStackState(JSON.stringify({ day: "2026-11-11", done: { a: "done" } }), today)).toEqual({});
    expect(parseStackState("{oops", today)).toEqual({});
  });
  it("finds the next day across months", () => {
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
  });
});
