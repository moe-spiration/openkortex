import { describe, expect, it } from "vitest";
import { dueReminders } from "../src/data/live";
import { demoRemindAt } from "../src/data/demoRemind";

const now = new Date(2026, 10, 4, 10, 0); // Wed 4 Nov 2026, 10:00 local
const at = (day: number, h: number) => new Date(2026, 10, day, h, 0).toISOString();

describe("dueReminders (Heute fällig)", () => {
  it("lists overdue and later-today reminders, oldest first, and skips tomorrow and none", () => {
    const e = [
      { id: "later", remindAt: at(4, 18) },
      { id: "tomorrow", remindAt: at(5, 8) },
      { id: "none", remindAt: null },
      { id: "unset" },
      { id: "overdue", remindAt: at(2, 8) },
      { id: "bad", remindAt: "nope" },
      { id: "late", remindAt: new Date(2026, 10, 4, 23, 59).toISOString() },
    ];
    expect(dueReminders(e, now).map((x) => x.id)).toEqual(["overdue", "later", "late"]);
  });

  it("drops an entry once the reminder is cleared or snoozed to tomorrow", () => {
    const e = [{ id: "a", remindAt: at(3, 8) }];
    expect(dueReminders(e, now)).toHaveLength(1);
    expect(dueReminders([{ ...e[0]!, remindAt: null }], now)).toHaveLength(0);
    expect(dueReminders([{ ...e[0]!, remindAt: at(5, 8) }], now)).toHaveLength(0);
  });
});

describe("demo reminders", () => {
  it("seeds three due reminders on demo entries", () => {
    const entries = ["e1", "e2", "e3", "e6", "e10"].map((id) => ({ id, remindAt: demoRemindAt(id, now) }));
    const due = dueReminders(entries, now);
    expect(due.map((x) => x.id)).toEqual(["e3", "e10", "e6"]);
    expect(demoRemindAt("e1", now)).toBeNull();
  });
});
