import { describe, expect, it } from "vitest";
import { captureLink, contentOf, entryLink, isFuture, itemIdOf, notificationId, planDue, pruneAnnounced, type DueItem } from "../src/notify/plan";

const due = (id: string, at: string, kind: DueItem["kind"] = "reminder"): DueItem => ({ id, title: `T ${id}`, remind_at: at, kind });

describe("planDue", () => {
  it("announces new items once and again after a snooze", () => {
    const first = planDue([due("a", "2026-11-04T08:00:00Z")], {});
    expect(first.show.map((d) => d.id)).toEqual(["a"]);
    expect(planDue([due("a", "2026-11-04T08:00:00Z")], first.announced).show).toEqual([]);
    expect(planDue([due("a", "2026-11-05T08:00:00Z")], first.announced).show.map((d) => d.id)).toEqual(["a"]);
  });

  it("skips what was scheduled locally (announced at scheduling time)", () => {
    expect(planDue([due("a", "2026-11-04T08:00:00Z")], { a: "2026-11-04T08:00:00Z" }).show).toEqual([]);
  });
});

describe("helpers", () => {
  it("maps radar ids to the item and builds deep links", () => {
    expect(itemIdOf("radar:abc:2026-11-04T08:00:00Z")).toBe("abc");
    expect(itemIdOf("abc")).toBe("abc");
    expect(entryLink("radar:abc:2026-11-04T08:00:00Z")).toBe("kortex://open?entry=abc");
    expect(captureLink("voice")).toBe("kortex://open?capture=voice");
    expect(notificationId("abc")).toBe("reminder:abc");
  });

  it("schedules only future instants", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    expect(isFuture("2026-11-04T10:00:01Z", now)).toBe(true);
    expect(isFuture("2026-11-04T10:00:00Z", now)).toBe(false);
    expect(isFuture(null, now)).toBe(false);
    expect(isFuture("nope", now)).toBe(false);
  });

  it("words reminders and radar changes and prunes old announcements", () => {
    expect(contentOf({ title: " ", kind: "reminder" })).toEqual({ title: "Ohne Titel", body: "Erinnerung" });
    expect(contentOf({ title: "X", kind: "radar" }).body).toContain("geändert");
    const now = new Date("2026-11-20T00:00:00Z");
    expect(pruneAnnounced({ old: "2026-11-01T00:00:00Z", fresh: "2026-11-15T00:00:00Z" }, now)).toEqual({ fresh: "2026-11-15T00:00:00Z" });
  });
});
