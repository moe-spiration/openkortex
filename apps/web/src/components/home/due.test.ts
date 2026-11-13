import { describe, expect, it } from "vitest";
import { dueToday } from "./due";

const item = (id: string, remindAt: string | null, status?: string) => ({ id, title: id, type: "note", remindAt, status });
const task = (id: string, due: string, done = false) => ({ id, title: id, due, done });

describe("dueToday", () => {
  const day = "2026-11-01"; // Berlin: ends 2026-11-01T22:59:59.999Z
  it("lists reminders up to the end of today, oldest first, and skips archived items", () => {
    const r = dueToday(
      [
        item("later-today", "2026-11-01T17:00:00Z"),
        item("overdue", "2026-10-28T07:00:00Z"),
        item("tomorrow", "2026-11-01T23:30:00Z"),
        item("none", null),
        item("archived", "2026-10-30T07:00:00Z", "archived"),
      ],
      [],
      day,
      "Europe/Berlin",
    );
    expect(r.reminders.map((i) => i.id)).toEqual(["overdue", "later-today"]);
  });

  it("snoozing moves an item out of today, clearing removes it", () => {
    const base = item("a", "2026-11-01T08:00:00Z");
    expect(dueToday([base], [], day, "Europe/Berlin").reminders).toHaveLength(1);
    expect(dueToday([{ ...base, remindAt: "2026-11-02T07:00:00Z" }], [], day, "Europe/Berlin").reminders).toHaveLength(0);
    expect(dueToday([{ ...base, remindAt: null }], [], day, "Europe/Berlin").reminders).toHaveLength(0);
  });

  it("lists open tasks due today or earlier", () => {
    const r = dueToday([], [task("t1", "2026-11-01"), task("t2", "2026-10-30"), task("t3", "2026-11-02"), task("t4", "2026-11-01", true)], day);
    expect(r.tasks.map((t) => t.id)).toEqual(["t2", "t1"]);
  });
});
