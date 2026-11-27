import { describe, expect, it } from "vitest";
import type { TaskRow } from "../src/data/live";
import type { DueItem } from "../src/notify/plan";
import { pttMayStart } from "../src/capture/ptt";
import { parseStyle, applyEntryPending, buildCheckin, buildEntries, buildToday, dueDay, endOfDay, mergeDue, parsePrefs, quickKindOf, quickLink, settingsFor, snoozeAt, withDefaultLook, withoutWidget, withWidget } from "../src/widgets/model";

const now = new Date(2026, 10, 4, 10, 0); // Wed 4 Nov 2026, 10:00 local
const task = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({ id, title: `Task ${id}`, status: "open", priority: "medium", due_date: null, source_item_id: null, created_at: "", ...over });
const due = (id: string, at: Date, kind: DueItem["kind"] = "reminder"): DueItem => ({ id, title: `R ${id}`, remind_at: at.toISOString(), kind });

describe("buildToday", () => {
  it("lists reminders first (by time), then tasks due today or overdue, oldest first", () => {
    const m = buildToday(
      [due("b", new Date(2026, 10, 4, 9, 30)), due("a", new Date(2026, 10, 4, 8, 5))],
      [task("t1", { due_date: "2026-11-04" }), task("t2", { due_date: "2026-11-02" }), task("t3", { due_date: "2026-11-09" }), task("t4", { due_date: "2026-11-04", status: "done" })],
      now,
      10,
    );
    expect(m.rows.map((r) => r.key)).toEqual(["a", "b", "t2", "t1"]);
    expect(m.rows[0]!.meta).toBe("Erinnerung · 08:05");
    expect(m.total).toBe(4);
    expect(m.more).toBe(0);
  });

  it("links reminders to the entry and tasks to their source entry (or just the app)", () => {
    const m = buildToday([due("radar:x:2026-11-04T08:00:00Z", new Date(2026, 10, 4, 8), "radar")], [task("t1", { due_date: "2026-11-04", source_item_id: "src" }), task("t2", { due_date: "2026-11-04" })], now, 5);
    expect(m.rows.map((r) => r.link)).toEqual(["kortex://open?entry=x", "kortex://open?entry=src", "kortex://open"]);
    expect(m.rows[0]!.meta).toBe("Seite geändert");
  });

  it("caps the rows and counts what did not fit", () => {
    const m = buildToday([], [task("1", { due_date: "2026-11-01" }), task("2", { due_date: "2026-11-02" }), task("3", { due_date: "2026-11-03" })], now, 2);
    expect(m.rows).toHaveLength(2);
    expect(m.more).toBe(1);
    expect(m.total).toBe(3);
  });

  it("takes timeframe today without a due date", () => {
    expect(buildToday([], [task("t", { timeframe: "today" })], now, 3).rows.map((r) => r.key)).toEqual(["t"]);
  });
});

describe("Heute ticks in the widget", () => {
  it("marks overdue tasks, keeps a just-ticked task as done and gives tasks their id", () => {
    const m = buildToday([], [task("old", { due_date: "2026-11-02" }), task("now", { due_date: "2026-11-04", status: "done" })], now, 10, ["now"]);
    expect(m.rows.map((r) => [r.key, r.overdue, r.done, r.taskId])).toEqual([
      ["old", true, false, "old"],
      ["now", false, true, "now"],
    ]);
  });
  it("drops a done task nobody ticked in the widget", () => {
    expect(buildToday([], [task("x", { due_date: "2026-11-04", status: "done" })], now, 10).rows).toHaveLength(0);
  });
});

describe("Einträge cards", () => {
  const item = (id: string, over: Record<string, unknown> = {}) => ({ id, type: "article", title: `Item ${id}`, summary: "**Kurz** gesagt", content_md: "# Lang", status: "processed", is_favorite: false, created_at: new Date(2026, 10, 4, 9, 5).toISOString(), ...over });
  it("turns rows into cards with plain summary, type label, day and link", () => {
    const [c] = buildEntries([item("a", { is_favorite: true })], now);
    expect(c).toMatchObject({ key: "a", title: "Item a", line: "Kurz gesagt", meta: "Artikel · Heute, 09:05", fav: true, processing: false, link: "kortex://open?entry=a", kind: "read" });
  });
  it("falls back to the text, marks entries in processing and caps the list", () => {
    const cards = buildEntries([item("a", { summary: null, content_md: "Erster Satz" }), item("b", { status: "processing" }), item("c")], now, 2);
    expect(cards.map((c) => c.line)).toEqual(["Erster Satz", "Kortex verarbeitet diesen Eintrag noch"]);
    expect(cards[1]!.processing).toBe(true);
  });
});

describe("Energie check-in", () => {
  it("lists the last seven days, today last with the current energy", () => {
    const m = buildCheckin("2026-11-04", { "2026-11-03": 6, "2026-10-29": 9, "2026-11-04": 2 }, 3, 8);
    expect(m.week.map((d) => d.day)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(m.week.map((d) => d.energy)).toEqual([9, null, null, null, null, 6, 8]);
    expect(m.week.map((d) => d.label).join("")).toBe("DFSSMDM");
    expect(m.streak).toBe(3);
  });
});

describe("widget prefs", () => {
  it("reads defaults from nothing or junk", () => {
    expect(parsePrefs(null)).toEqual({ look: { opacity: 0.85, theme: "system" }, byId: {} });
    expect(parsePrefs("{oops")).toEqual(parsePrefs(null));
    expect(parsePrefs(JSON.stringify({ look: { opacity: 7, theme: "neon" }, byId: { 3: { source: "x", opacity: 0.3 } } }))).toEqual({ look: { opacity: 0.85, theme: "system" }, byId: { 3: { opacity: 0.3 } } });
  });
  it("a widget's own choice wins over the default; a new default resets look but keeps the source", () => {
    let p = parsePrefs(null);
    p = withWidget(p, 7, { opacity: 0, source: "favorites" });
    expect(settingsFor(p, 7)).toEqual({ opacity: 0, theme: "system", source: "favorites" });
    expect(settingsFor(p, 8)).toEqual({ opacity: 0.85, theme: "system", source: "recent" });
    p = withDefaultLook(p, { opacity: 0.5, theme: "dark" });
    expect(settingsFor(p, 7)).toEqual({ opacity: 0.5, theme: "dark", source: "favorites" });
    expect(withoutWidget(p, 7).byId).toEqual({});
  });
});

describe("tasks due today (timestamptz due_date)", () => {
  it("matches a due_date with a time part: the API answers timestamptz, not a bare date", () => {
    const m = buildToday(
      [],
      [
        task("today", { due_date: new Date(2026, 10, 4, 15, 30).toISOString() }),
        task("overdue", { due_date: new Date(2026, 10, 2, 9).toISOString() }),
        task("tomorrow", { due_date: new Date(2026, 10, 5, 9).toISOString() }),
        task("midnight-utc", { due_date: "2026-11-04T00:00:00+00:00" }),
        task("tomorrow-midnight-utc", { due_date: "2026-11-05T00:00:00+00:00" }),
        task("planned", { timeframe: "today" }),
      ],
      now,
      10,
    );
    expect(m.rows.map((r) => r.key).sort()).toEqual(["midnight-utc", "overdue", "planned", "today"]);
  });

  it("dueDay keeps date-only and midnight-UTC values and converts real times to the local day", () => {
    expect(dueDay("2026-11-04")).toBe("2026-11-04");
    expect(dueDay("2026-11-04T00:00:00+00:00")).toBe("2026-11-04");
    expect(dueDay("2026-11-04T00:00:00Z")).toBe("2026-11-04");
    expect(dueDay(new Date(2026, 10, 4, 23, 30).toISOString())).toBe("2026-11-04");
  });
});

describe("pttMayStart (hold-to-talk gating)", () => {
  it("allows a hold from idle, but not with the fan open or while a voice capture already runs", () => {
    expect(pttMayStart(false, null)).toBe(true);
    expect(pttMayStart(false, "note")).toBe(true);
    expect(pttMayStart(true, null)).toBe(false);
    expect(pttMayStart(false, "voice")).toBe(false);
  });
});

describe("Heute until end of day", () => {
  it("mergeDue adds reminders still coming today and does not double an id the server already lists", () => {
    const a = due("a", new Date(2026, 10, 4, 8));
    const later = due("b", new Date(2026, 10, 4, 18));
    expect(mergeDue([a], [a, later]).map((d) => d.id)).toEqual(["a", "b"]);
    const m = buildToday(mergeDue([], [later]), [], now, 5);
    expect(m.rows.map((r) => r.meta)).toEqual(["Erinnerung · 18:00"]);
  });
  it("endOfDay is the last millisecond of the local day", () => {
    expect(endOfDay(now).getHours()).toBe(23);
    expect(endOfDay(now).getDate()).toBe(4);
  });
});

describe("direct actions in the widgets", () => {
  it("a reminder done or a radar change seen in the widget is drawn as done", () => {
    const m = buildToday([due("r1", new Date(2026, 10, 4, 9)), due("radar:x:1", new Date(2026, 10, 4, 8), "radar")], [], now, 40, ["r1", "radar:x:1"]);
    expect(m.rows.map((r) => [r.dueId, r.done])).toEqual([
      ["radar:x:1", true],
      ["r1", true],
    ]);
  });

  it("a reminder put off moves to its new time today, or leaves the list when it lands tomorrow", () => {
    const list = [due("a", new Date(2026, 10, 4, 9)), due("b", new Date(2026, 10, 4, 9, 30))];
    const later = buildToday(list, [], now, 40, [], { a: new Date(2026, 10, 4, 11).toISOString() });
    expect(later.rows.map((r) => r.key)).toEqual(["b", "a"]);
    const tomorrow = buildToday(list, [], now, 40, [], { a: snoozeAt("tomorrow", now) });
    expect(tomorrow.rows.map((r) => r.key)).toEqual(["b"]);
  });

  it("snoozeAt: +1 h, or tomorrow 08:00 local", () => {
    expect(Date.parse(snoozeAt("hour", now)) - now.getTime()).toBe(3_600_000);
    const d = new Date(snoozeAt("tomorrow", now));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([5, 8, 0]);
  });

  it("entry cards carry read and the inbox suggestion; pending changes are drawn at once", () => {
    const cards = buildEntries(
      [
        { id: "a", type: "article", title: "A", summary: null, content_md: null, status: "processed", is_favorite: false, created_at: now.toISOString(), read_at: "2026-11-03T10:00:00Z", target: "20_Projects/Kortex_App" },
        { id: "b", type: "note", title: "B", summary: null, content_md: null, status: "processed", is_favorite: true, created_at: now.toISOString() },
      ],
      now,
    );
    expect(cards.map((c) => [c.key, c.read, c.target ?? null, c.targetLabel ?? null])).toEqual([
      ["a", true, "20_Projects/Kortex_App", "Kortex App"],
      ["b", false, null, null],
    ]);
    const next = applyEntryPending(cards, { fav: { a: true, b: false }, read: { a: false }, filed: ["b"] });
    expect(next.map((c) => [c.key, c.fav, c.read])).toEqual([["a", true, false]]);
  });

  it("quick overlay links and kinds", () => {
    expect(quickLink("voice")).toBe("kortexquick://capture?kind=voice");
    expect([quickKindOf("task"), quickKindOf("voice"), quickKindOf("x"), quickKindOf(undefined)]).toEqual(["task", "voice", "note", "note"]);
  });
});

describe("app style for widgets and the quick overlay", () => {
  it("reads accent, look and mode from kortex.prefs, defaults for nothing or junk", () => {
    expect(
      parseStyle(JSON.stringify({ themePref: 2, accent: "teal", look: "ruhe", haptics: true })),
    ).toEqual({ accent: "teal", look: "ruhe", themePref: 2 });
    expect(parseStyle(null).look).toBe("ruhe");
    expect(parseStyle(JSON.stringify({ look: "classic" })).look).toBe("ruhe");
    expect(parseStyle(JSON.stringify({ look: "vivid" })).look).toBe("vivid");
    expect(parseStyle("{oops").themePref).toBe(0);
    expect(parseStyle(JSON.stringify({ look: "neon", themePref: 7 }))).toMatchObject({
      look: "ruhe",
      themePref: 0,
    });
  });
});
