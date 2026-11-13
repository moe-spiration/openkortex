import { describe, expect, it } from "vitest";
import { groupReminders } from "./groups";

const day = "2026-11-03";
const w = (extra: object = {}) => ({ enabled: true, interval: "daily" as const, ...extra });

describe("groupReminders", () => {
  it("splits due (today or overdue, oldest first) from upcoming and hides archived items", () => {
    const g = groupReminders(
      [
        { id: "a", title: "A", remindAt: "2026-11-03T17:00:00.000Z" },
        { id: "b", title: "B", remindAt: "2026-11-01T08:00:00.000Z" },
        { id: "c", title: "C", remindAt: "2026-11-05T08:00:00.000Z" },
        { id: "d", title: "D", remindAt: "2026-11-01T08:00:00.000Z", status: "archived" },
        { id: "e", title: "E" },
      ],
      day,
    );
    expect(g.due.map((i) => i.id)).toEqual(["b", "a"]);
    expect(g.upcoming.map((i) => i.id)).toEqual(["c"]);
  });

  it("lists watched pages with unseen changes first", () => {
    const g = groupReminders(
      [
        { id: "old", title: "o", watch: w({ last_checked_at: "2026-11-03T08:00:00.000Z" }) },
        { id: "new", title: "n", watch: w({ last_diff: { at: "2026-11-02T08:00:00.000Z", summary: "x", added: [], removed: [] } }) },
        { id: "off", title: "x", watch: w({ enabled: false }) },
      ],
      day,
    );
    expect(g.watched.map((i) => i.id)).toEqual(["new", "old"]);
  });
});
