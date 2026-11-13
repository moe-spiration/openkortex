import { describe, expect, it } from "vitest";
import { DEFAULT_WEEKLY_DIGEST_DAY, gardenerView, meetingView, participantsOf, reviewBadge, type ShellStatusData } from "./status-core";
import { MOCK_USER_SETTINGS } from "@/lib/mock/settings";

const base: ShellStatusData = {
  queued: 0,
  processing: 0,
  errors: 0,
  processed24h: 3,
  lastProcessed: { title: "Zettelkasten", at: "2026-10-23T09:18:00Z" },
  meeting: null,
  fetchedAt: "2026-10-23T10:00:00Z",
};

describe("gardenerView", () => {
  it("is synchron when nothing is pending", () => {
    const v = gardenerView(base, "Europe/Berlin");
    expect(v).toMatchObject({ label: "AI Gardener · Vault synchron", tone: "synced" });
    expect(v.detail).toBe("3 verarbeitet in 24 h · zuletzt „Zettelkasten“ 11:18");
  });

  it("counts work in progress first, then errors", () => {
    expect(gardenerView({ ...base, queued: 1, processing: 2, errors: 1 }).label).toBe("AI Gardener · 3 in Arbeit");
    expect(gardenerView({ ...base, queued: 1 }).tone).toBe("busy");
    expect(gardenerView({ ...base, errors: 2 })).toMatchObject({ label: "AI Gardener · 2 Fehler", tone: "error" });
  });
});

describe("meetingView", () => {
  it("shapes the newest meeting item for the card", () => {
    const v = meetingView(
      { id: "m1", title: "Q4 Sync", status: "processing", created_at: "2026-10-23T09:00:00Z", participants: ["Max", "Louisa", "Sven"], summary: null, coaching: null },
      "Europe/Berlin",
    );
    expect(v).toMatchObject({ title: "Q4 Sync", clock: "11:00", noteId: "m1", processing: true, coaching: "" });
    expect(v.people.map((p) => p.initial)).toEqual(["M", "L", "S"]);
    expect(v.people[0]!.tone).toBeUndefined();
  });

  it("marks a running live session (W1) as live, not as processing", () => {
    const v = meetingView(
      { id: "m2", title: "Live", status: "processing", created_at: "2026-10-23T09:00:00Z", participants: [], summary: null, coaching: null, live_started_at: "2026-10-23T09:00:00Z" },
      "Europe/Berlin",
    );
    expect(v).toMatchObject({ live: true, processing: false, startedAt: "2026-10-23T09:00:00Z" });
  });

  it("reads participants from the meeting adapter or older shapes", () => {
    expect(participantsOf({ participants: ["A", "B"] })).toEqual(["A", "B"]);
    expect(participantsOf({ attendees: [{ name: "C" }] })).toEqual(["C"]);
    expect(participantsOf(null)).toEqual([]);
  });
});

describe("review badge (W6/A-07)", () => {
  // 2026-10-25: Sunday, end of summer time in Europe (03:00 CEST → 02:00 CET = 01:00 UTC).
  const now = (iso: string) => new Date(iso);

  it("follows weekly_digest_day: due today on the review day, else the next one", () => {
    expect(reviewBadge({ now: now("2026-10-25T10:00:00Z"), timeZone: "Europe/Berlin", digestDay: 0 })).toMatchObject({
      weekdayShort: "So",
      date: "2026-10-25",
      daysUntil: 0,
      tooltip: "Wochen-Review heute fällig (So, 25.10.2026)",
    });
    expect(reviewBadge({ now: now("2026-10-25T10:00:00Z"), timeZone: "Europe/Berlin", digestDay: 5 })).toMatchObject({
      weekdayShort: "Fr",
      date: "2026-10-30",
      tooltip: "Wochen-Review fällig: Fr, 30.10.2026",
    });
  });

  it("no badge while loading or without a day (no So before the stored Fr)", () => {
    expect(reviewBadge({ now: now("2026-10-25T10:00:00Z"), digestDay: 5, loading: true })).toBeNull();
    expect(reviewBadge({ now: now("2026-10-25T10:00:00Z"), digestDay: null })).toBeNull();
    expect(reviewBadge({ now: now("2026-10-25T10:00:00Z"), digestDay: undefined })).toBeNull();
  });

  it("DB default and mock fallback agree: Friday", () => {
    expect(DEFAULT_WEEKLY_DIGEST_DAY).toBe(5);
    expect(MOCK_USER_SETTINGS.weekly_digest_day).toBe(DEFAULT_WEEKLY_DIGEST_DAY);
  });

  it("DST change night 24./25.10.2026 in Berlin: the weekday never flips, the date only at local midnight", () => {
    const sun = 0;
    // Sat 23:59:59 CEST → review tomorrow; Sun 00:00 CEST → today; 02:30 before/after the switch → today;
    // Sun 23:59:59 CET → today; Mon 00:00 CET → next Sunday.
    const cases: Array<[string, string, number]> = [
      ["2026-10-24T21:59:59Z", "2026-10-25", 1],
      ["2026-10-24T22:00:00Z", "2026-10-25", 0],
      ["2026-10-25T00:30:00Z", "2026-10-25", 0],
      ["2026-10-25T01:30:00Z", "2026-10-25", 0],
      ["2026-10-25T22:59:59Z", "2026-10-25", 0],
      ["2026-10-25T23:00:00Z", "2026-11-01", 6],
    ];
    for (const [iso, date, daysUntil] of cases) {
      const b = reviewBadge({ now: now(iso), timeZone: "Europe/Berlin", digestDay: sun })!;
      expect([b.weekdayShort, b.date, b.daysUntil]).toEqual(["So", date, daysUntil]);
    }
  });

  it("time zone matters: one instant, different due days (UTC, Berlin, Los Angeles)", () => {
    const at = now("2026-10-24T22:30:00Z"); // Sat 22:30 UTC = Sun 00:30 Berlin = Sat 15:30 LA
    const day = (timeZone: string) => reviewBadge({ now: at, timeZone, digestDay: 6 })!.daysUntil; // Saturday review
    expect(day("UTC")).toBe(0);
    expect(day("America/Los_Angeles")).toBe(0);
    expect(day("Europe/Berlin")).toBe(6);
  });
});
