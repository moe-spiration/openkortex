import { describe, expect, it } from "vitest";
import { duePeriod, groupJobs, hasActiveJobs, isStale, jobPercent, jobTitle, labelParts, overnightJobs, parseStandingOrder, proposalKind, proposalMeta, scheduleLabel, splitFinished, type JobView } from "./agent-jobs";

const job = (id: string, patch: Partial<JobView> = {}): JobView => ({
  id,
  title: id,
  prompt: id,
  skill: null,
  autonomy: "ask",
  status: "done",
  origin: "manual",
  actionItemId: null,
  result: null,
  error: null,
  createdAt: "2026-11-12T08:00:00Z",
  startedAt: null,
  finishedAt: null,
  ...patch,
});

describe("standing orders from a sentence", () => {
  it("reads daily orders in German and English", () => {
    expect(parseStandingOrder("Jeden Morgen um 6 Uhr den Tagesstapel vorbereiten")).toEqual({
      cadence: "daily",
      hour: 6,
      weekday: null,
      prompt: "Den Tagesstapel vorbereiten",
      title: "Jeden Morgen um 6 Uhr den Tagesstapel vorbereiten",
    });
    expect(parseStandingOrder("täglich um 21:30 Uhr Inbox aufräumen")).toMatchObject({ cadence: "daily", hour: 21, prompt: "Inbox aufräumen" });
    expect(parseStandingOrder("Jeden Abend, bitte die offenen Schleifen zusammenfassen")).toMatchObject({ cadence: "daily", hour: 18, prompt: "Die offenen Schleifen zusammenfassen" });
    expect(parseStandingOrder("Every day at 7 pm tidy the inbox")).toMatchObject({ cadence: "daily", hour: 19, prompt: "Tidy the inbox" });
    expect(parseStandingOrder("Daily summarize what is new")).toMatchObject({ cadence: "daily", hour: 7 });
  });

  it("reads weekly orders", () => {
    expect(parseStandingOrder("Sonntags um 18 Uhr Wochenrückblick entwerfen")).toMatchObject({ cadence: "weekly", weekday: 7, hour: 18, prompt: "Wochenrückblick entwerfen" });
    expect(parseStandingOrder("Jeden Freitag meine Leseliste zusammenfassen")).toMatchObject({ cadence: "weekly", weekday: 5, hour: 7, prompt: "Meine Leseliste zusammenfassen" });
    expect(parseStandingOrder("Every Monday morning prepare my week")).toMatchObject({ cadence: "weekly", weekday: 1, hour: 6, prompt: "Prepare my week" });
    expect(parseStandingOrder("On Wednesdays at 9 am update the dossier of Nordlicht")).toMatchObject({ cadence: "weekly", weekday: 3, hour: 9 });
  });

  it("refuses sentences without a schedule or without work", () => {
    expect(parseStandingOrder("Fasse meine Leseliste zusammen")).toBeNull();
    expect(parseStandingOrder("Jeden Freitag")).toBeNull();
    expect(parseStandingOrder("")).toBeNull();
  });

  it("labels the schedule (tests run in German)", () => {
    expect(scheduleLabel({ cadence: "daily", hour: 6, weekday: null })).toBe("Täglich um 06:00");
    expect(scheduleLabel({ cadence: "weekly", hour: 18, weekday: 7 })).toBe("Jeden Sonntag um 18:00");
  });

  it("is due once per day or week, from its hour on", () => {
    const daily = { cadence: "daily" as const, hour: 6, weekday: null, enabled: true, lastPeriod: null };
    const thu = { date: "2026-11-12", week: "2026-W46", weekday: 4, hour: 6 };
    expect(duePeriod(daily, { ...thu, hour: 5 })).toBeNull();
    expect(duePeriod(daily, thu)).toBe("2026-11-12");
    expect(duePeriod(daily, { ...thu, hour: 15 })).toBe("2026-11-12");
    expect(duePeriod({ ...daily, lastPeriod: "2026-11-12" }, thu)).toBeNull();
    expect(duePeriod({ ...daily, lastPeriod: "2026-11-11" }, thu)).toBe("2026-11-12");
    expect(duePeriod({ ...daily, enabled: false }, thu)).toBeNull();
    const weekly = { cadence: "weekly" as const, hour: 18, weekday: 4, enabled: true, lastPeriod: "2026-W45" };
    expect(duePeriod(weekly, { ...thu, hour: 18 })).toBe("2026-W46");
    expect(duePeriod(weekly, { ...thu, hour: 17 })).toBeNull();
    expect(duePeriod(weekly, { ...thu, weekday: 5, hour: 20 })).toBeNull();
    expect(duePeriod({ ...weekly, lastPeriod: "2026-W46" }, { ...thu, hour: 19 })).toBeNull();
  });
});

describe("job lists", () => {
  it("shortens a long request to a title", () => {
    expect(jobTitle("  Kurz  und\nknapp ")).toBe("Kurz und knapp");
    expect(jobTitle("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("groups into waiting, running and finished", () => {
    const jobs = [
      job("a", { status: "done", finishedAt: "2026-11-12T09:00:00Z" }),
      job("b", { status: "waiting", finishedAt: "2026-11-12T10:00:00Z" }),
      job("c", { status: "running" }),
      job("d", { status: "queued", createdAt: "2026-11-12T07:00:00Z" }),
      job("e", { status: "error", finishedAt: "2026-11-12T11:00:00Z" }),
      job("f", { status: "cancelled" }),
    ];
    const g = groupJobs(jobs);
    expect(g.waiting.map((j) => j.id)).toEqual(["b"]);
    expect(g.running.map((j) => j.id)).toEqual(["d", "c"]);
    expect(g.finished.map((j) => j.id)).toEqual(["e", "a"]);
    expect(hasActiveJobs(jobs)).toBe(true);
    expect(hasActiveJobs([jobs[0]!])).toBe(false);
  });

  it("knows a job that was cut off", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(isStale(job("a", { status: "running", startedAt: "2026-11-12T11:40:00Z" }), now)).toBe(true);
    expect(isStale(job("b", { status: "running", startedAt: "2026-11-12T11:55:00Z" }), now)).toBe(false);
    expect(isStale(job("c", { status: "done", startedAt: "2026-11-12T08:00:00Z" }), now)).toBe(false);
  });

  it("lists what standing orders finished in the last 18 hours", () => {
    const now = new Date("2026-11-12T07:00:00Z");
    const jobs = [
      job("night", { origin: "standing", finishedAt: "2026-11-12T05:10:00Z" }),
      job("wait", { origin: "standing", status: "waiting", finishedAt: "2026-11-12T05:30:00Z" }),
      job("old", { origin: "standing", finishedAt: "2026-11-11T08:00:00Z" }),
      job("manual", { origin: "manual", finishedAt: "2026-11-12T06:00:00Z" }),
      job("failed", { origin: "standing", status: "error", finishedAt: "2026-11-12T06:00:00Z" }),
    ];
    expect(overnightJobs(jobs, now).map((j) => j.id)).toEqual(["wait", "night"]);
  });
});

describe("Ruhe job list helpers", () => {
  it("reads the kind of a proposed change", () => {
    expect(proposalKind({ kind: "task_create", title: "x" })).toBe("task_create");
    expect(proposalKind({ title: "x" })).toBeNull();
    expect(proposalKind(null)).toBeNull();
    expect(proposalKind("note_create")).toBeNull();
  });

  it("splits finished jobs into today and earlier", () => {
    const now = new Date(2026, 10, 26, 12, 0);
    const at = (d: Date) => ({ finishedAt: d.toISOString(), createdAt: d.toISOString() }) as JobView;
    const a = at(new Date(2026, 10, 26, 6, 10));
    const b = at(new Date(2026, 10, 25, 22, 0));
    const { today, earlier } = splitFinished([a, b], now);
    expect(today).toEqual([a]);
    expect(earlier).toEqual([b]);
  });
});

describe("job page details (Ruhe)", () => {
  it("reads the progress of a running job only", () => {
    const progress = { done: 7, total: 11 };
    expect(jobPercent(job("a", { status: "running", result: { progress } }))).toBe(64);
    expect(jobPercent(job("b", { status: "done", result: { progress } }))).toBeNull();
    expect(jobPercent(job("c", { status: "running", result: { progress: { done: 1, total: 0 } } }))).toBeNull();
    expect(jobPercent(job("d", { status: "running" }))).toBeNull();
  });

  it("splits a label into text, entities and wiki links", () => {
    expect(labelParts("Akte **Jonas Weber** gelesen, siehe [[Plattform-Migration]].")).toEqual([
      { kind: "text", text: "Akte " },
      { kind: "strong", text: "Jonas Weber" },
      { kind: "text", text: " gelesen, siehe " },
      { kind: "link", text: "Plattform-Migration" },
      { kind: "text", text: "." },
    ]);
    expect(labelParts("[[Ziel|Alias]]")).toEqual([{ kind: "link", text: "Alias" }]);
    expect(labelParts("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });

  it("names a fact for each proposed change", () => {
    expect(proposalMeta({ kind: "task_create", title: "x", due_date: "2026-11-28" })).toMatch(/28/);
    expect(proposalMeta({ kind: "task_create", title: "x" })).toBe("");
    expect(proposalMeta({ kind: "dossier_update", state: "Eins. Zwei." })).toBe("+2 Sätze");
    expect(proposalMeta({ kind: "dossier_update", open_points: ["a"] })).toBe("1 offener Punkt");
    expect(proposalMeta({ kind: "note_edit", append_markdown: "[[Plattform-Migration]]" })).toBe("Rückverweis");
    expect(proposalMeta({ kind: "note_edit", replacements: [{}, {}] })).toBe("2 Änderungen");
    expect(proposalMeta({ kind: "note_create", folder_path: "10_Notes" })).toBe("10_Notes");
    expect(proposalMeta(null)).toBe("");
  });
});
