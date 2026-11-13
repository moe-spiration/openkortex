import { describe, expect, it } from "vitest";
import { attentionCount, reminderGroups, watchLine } from "../src/lib/reminders";

const now = new Date(2026, 10, 6, 10, 0, 0);
const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).toISOString();

describe("reminders sheet groups", () => {
  it("splits due (up to end of today, overdue first) from upcoming", () => {
    const g = reminderGroups(
      [
        { id: "later", remindAt: at(9, 8) },
        { id: "tonight", remindAt: at(6, 21) },
        { id: "overdue", remindAt: at(4, 8) },
        { id: "tomorrow", remindAt: at(7, 8) },
        { id: "none", remindAt: null },
      ],
      now,
    );
    expect(g.due.map((e) => e.id)).toEqual(["overdue", "tonight"]);
    expect(g.upcoming.map((e) => e.id)).toEqual(["tomorrow", "later"]);
  });

  it("lists enabled watches only, unseen changes first", () => {
    const g = reminderGroups(
      [
        { id: "off", meta: { watch: { enabled: false, interval: "daily" } } },
        { id: "quiet", meta: { watch: { enabled: true, interval: "weekly", last_checked_at: at(6, 6) } } },
        { id: "seen", meta: { watch: { enabled: true, interval: "daily", last_diff: { at: at(5, 6), summary: "x" }, seen_at: at(5, 9) } } },
        { id: "new", meta: { watch: { enabled: true, interval: "daily", last_diff: { at: at(3, 6), summary: "Preis gesenkt" } } } },
        { id: "plain", meta: { status: "processed" } },
      ],
      now,
    );
    expect(g.watched.map((w) => w.entry.id)).toEqual(["new", "quiet", "seen"]);
    expect(g.watched[0]!.unseen).toBe(true);
    expect(attentionCount(g)).toBe(1);
  });

  it("describes a watch", () => {
    expect(watchLine({ enabled: true, interval: "daily" })).toBe("Noch nicht geprüft · täglich");
    expect(watchLine({ enabled: true, interval: "weekly", status: "nicht beobachtbar", reason: "403" })).toBe("Nicht beobachtbar: 403");
    expect(watchLine({ enabled: true, interval: "daily", last_diff: { at: at(5, 6), summary: "x", added: [], removed: [] } })).toMatch(/^Geändert .* · täglich$/);
  });
});
