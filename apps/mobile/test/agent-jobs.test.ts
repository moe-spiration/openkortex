import { describe, expect, it } from "vitest";
import { groupJobs, isStale, looksLikeStandingOrder, overnightJobs, type JobView } from "../src/lib/agentJobs";
import { presortPrompt } from "../src/lib/stack";

const now = new Date("2026-11-12T08:00:00Z");
const J = (id: string, over: Partial<JobView> = {}): JobView => ({
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
  createdAt: "2026-11-12T06:00:00Z",
  startedAt: "2026-11-12T06:00:00Z",
  finishedAt: "2026-11-12T06:05:00Z",
  ...over,
});

describe("agent jobs", () => {
  it("groups waiting, running and finished like the web", () => {
    const g = groupJobs([J("a"), J("w", { status: "waiting" }), J("r", { status: "running", finishedAt: null }), J("q", { status: "queued", finishedAt: null }), J("x", { status: "cancelled" })]);
    expect(g.waiting.map((j) => j.id)).toEqual(["w"]);
    expect(g.running.map((j) => j.id).sort()).toEqual(["q", "r"]);
    expect(g.finished.map((j) => j.id)).toEqual(["a"]);
  });

  it("marks a job that runs for too long as stale", () => {
    expect(isStale(J("r", { status: "running", startedAt: "2026-11-12T07:00:00Z" }), now)).toBe(true);
    expect(isStale(J("r", { status: "running", startedAt: "2026-11-12T07:55:00Z" }), now)).toBe(false);
    expect(isStale(J("d"), now)).toBe(false);
  });

  it("shows what standing orders finished overnight", () => {
    const jobs = [J("s", { origin: "standing" }), J("m"), J("old", { origin: "standing", finishedAt: "2026-11-10T06:00:00Z" }), J("w", { origin: "standing", status: "waiting" })];
    expect(overnightJobs(jobs, now).map((j) => j.id).sort()).toEqual(["s", "w"]);
  });

  it("tells standing orders from questions", () => {
    expect(looksLikeStandingOrder("Jeden Morgen um 6 den Tagesstapel vorbereiten")).toBe(true);
    expect(looksLikeStandingOrder("Sonntags um 18 Uhr Wochenrückblick entwerfen")).toBe(true);
    expect(looksLikeStandingOrder("Every Friday summarize my reading list")).toBe(true);
    expect(looksLikeStandingOrder("Was habe ich diese Woche gespeichert?")).toBe(false);
  });

  it("writes the presort job from the open cards", () => {
    const p = presortPrompt([{ kind: "task", title: "Angebot schicken", sub: "Heute fällig" }]);
    expect(p.split("\n")).toHaveLength(2);
    expect(p).toContain("Angebot schicken (Heute fällig)");
  });
});
