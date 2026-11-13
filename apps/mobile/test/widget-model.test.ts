import { describe, expect, it } from "vitest";
import type { TaskRow } from "../src/data/live";
import type { DueItem } from "../src/notify/plan";
import { pttMayStart } from "../src/capture/ptt";
import { buildToday, dueDay, endOfDay, mergeDue, rowsFor } from "../src/widgets/model";

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

describe("rowsFor", () => {
  it("fits 1 to 6 rows to the widget height", () => {
    expect([rowsFor(60), rowsFor(110), rowsFor(250), rowsFor(900)]).toEqual([1, 1, 5, 6]);
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
