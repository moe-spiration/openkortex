import { describe, expect, it } from "vitest";
import type { HomeView } from "@/lib/data/home";
import { buildStack, parseStackState, STACK_MAX, type StackItemLike, presortPrompt } from "./stack";

const DAY = "2026-11-12";
const item = (id: string, extra: Partial<StackItemLike> = {}): StackItemLike => ({
  id,
  title: `Eintrag ${id}`,
  type: "article",
  path: `30_Clippings/${id}.md`,
  date: "2026-10-01",
  ...extra,
});
const task = (id: string, due: string, done = false) => ({ id, title: `Aufgabe ${id}`, due, done, sourceId: "n1" });
const VIEW: HomeView = {
  backIn: [],
  archive: { title: "Alte Notiz", quote: "Zitat", since: null, yearAgo: true, date: null, target: { kind: "note", id: "old" } },
  flashcards: { deck: "Self-Hosting", cards: [["Frage?", "Antwort."]], doneHint: "", target: null },
  fitsToday: { eyebrow: "Passt zu heute", title: "Contextual Retrieval", text: "Text", img: null, target: { kind: "note", id: "cr" } },
};

describe("buildStack", () => {
  it("puts due tasks first, then reminders, inbox, rediscover and a flashcard", () => {
    const cards = buildStack({
      items: [
        item("n1", { title: "Q4 Sync" }),
        item("r1", { remindAt: "2026-11-12T07:00:00.000Z" }),
        item("i1", { path: "00_Inbox/i1.md", date: DAY, tldr: "Kurz gesagt." }),
      ],
      tasks: [task("t2", DAY), task("t1", "2026-11-10"), task("t3", "2026-11-20"), task("t4", DAY, true)],
      view: VIEW,
      day: DAY,
      titleOf: (id) => (id === "n1" ? "Q4 Sync" : undefined),
    });
    expect(cards.map((c) => c.id)).toEqual([
      "task:t1",
      "task:t2",
      "remind:r1",
      "inbox:i1",
      "redis:f:Contextual Retrieval",
      "redis:a:Alte Notiz",
      "flash:Self-Hosting:Frage?",
    ]);
    expect(cards[0]).toMatchObject({ kind: "task", sub: "Überfällig seit 10. Nov.", chips: ["Q4 Sync"], refId: "t1" });
    expect(cards[3]).toMatchObject({ sub: "Kurz gesagt." });
    expect(cards.at(-1)).toMatchObject({ kind: "flash", answer: "Antwort." });
  });

  it("sums up what was filed since yesterday in one card", () => {
    const cards = buildStack({
      items: [
        item("a", { date: DAY, cover: "/a.png" }),
        item("b", { date: "2026-11-11", cover: "/b.png" }),
        item("c", { date: DAY, path: "20_Meetings/c.md" }),
        item("old", { date: "2026-11-01" }),
        item("in", { date: DAY, path: "00_Inbox/in.md" }),
      ],
      tasks: [],
      view: null,
      day: DAY,
    });
    const filed = cards.find((c) => c.kind === "filed")!;
    expect(filed.title).toBe("3 neue Einträge einsortiert");
    expect(filed.chips).toEqual(["30_Clippings · 2", "20_Meetings · 1"]);
    expect(filed.imgs).toEqual(["/a.png", "/b.png"]);
  });

  it("leaves out archived and failed entries and caps the stack", () => {
    const items = [
      item("x", { path: "00_Inbox/x.md", status: "archived" }),
      item("y", { path: "00_Inbox/y.md", status: "error" }),
      ...Array.from({ length: 6 }, (_, i) => item(`r${i}`, { remindAt: "2026-11-11T07:00:00.000Z" })),
    ];
    const tasks = Array.from({ length: 6 }, (_, i) => task(`t${i}`, DAY));
    const cards = buildStack({ items, tasks, view: VIEW, day: DAY });
    expect(cards.some((c) => c.kind === "inbox")).toBe(false);
    expect(cards.filter((c) => c.kind === "task")).toHaveLength(3);
    expect(cards.filter((c) => c.kind === "remind")).toHaveLength(2);
    expect(cards.length).toBeLessThanOrEqual(STACK_MAX);
  });

  it("is empty when nothing needs a decision", () => {
    expect(buildStack({ items: [item("a")], tasks: [], view: null, day: DAY })).toEqual([]);
  });
});

describe("parseStackState", () => {
  it("keeps the outcomes of the same day and drops everything else", () => {
    const raw = JSON.stringify({ day: DAY, done: { "task:t1": "done", "redis:a": "aside", bad: "x" } });
    expect(parseStackState(raw, DAY)).toEqual({ "task:t1": "done", "redis:a": "aside" });
    expect(parseStackState(raw, "2026-11-13")).toEqual({});
    expect(parseStackState("{broken", DAY)).toEqual({});
    expect(parseStackState(null, DAY)).toEqual({});
  });
});

describe("presortPrompt", () => {
  it("lists the open cards with their kind, one per line", () => {
    const text = presortPrompt([
      { kind: "task", title: "Angebot schicken", sub: "fällig heute" },
      { kind: "inbox", title: "Artikel über Agenten", sub: "" },
    ]);
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("- Aufgabe: Angebot schicken (fällig heute)");
    expect(lines[2]).toBe("- Eingang: Artikel über Agenten");
  });
});
