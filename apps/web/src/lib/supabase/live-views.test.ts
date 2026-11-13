import { describe, expect, it } from "vitest";
import type { KnowledgeItem } from "@/lib/mock/types";
import {
  activityHeat,
  dailyStreak,
  inboxTargets,
  isReviewCandidate,
  MANUAL_TASK_MARK,
  toProposal,
  toTask,
  weekStrip,
  type ActionRow,
} from "./live-views";

const item = (over: Partial<KnowledgeItem>): KnowledgeItem => ({
  id: "i1",
  type: "article",
  title: "Zone 2 Training",
  path: "30_Clippings/zone-2.md",
  date: "2026-10-20",
  time: "10:00",
  tags: ["#fitness/zone2"],
  tldr: "Langsam laufen.",
  links: [],
  contentMd: "",
  cover: null,
  actionItems: [],
  metadata: {},
  manualPlacement: false,
  folderSuggestion: null,
  status: "processed",
  source: { url: "https://www.example.com/zone2" },
  ...over,
});

const action = (over: Partial<ActionRow>): ActionRow => ({
  id: "a1",
  title: "Laufschuhe kaufen",
  description: null,
  status: "open",
  priority: "high",
  due_date: null,
  assignee: "Me",
  source_item_id: null,
  source_timestamp_sec: null,
  created_at: "2026-10-20T08:00:00Z",
  ...over,
});

describe("toTask", () => {
  it("maps due date (local day + time), priority, source kind and tag", () => {
    const t = toTask(
      action({ due_date: "2026-10-23T13:30:00Z", source_item_id: "m1", source_timestamp_sec: 75 }),
      item({ id: "m1", type: "meeting" }),
      "Europe/Berlin",
    );
    expect(t).toMatchObject({
      due: "2026-10-23",
      dueTime: "15:30",
      priority: "high",
      sourceKind: "meeting",
      tag: "#fitness/zone2",
      sourceSec: 75,
      ai: true,
      done: false,
    });
  });

  it("maps project, timeframe, context, export state and external ref only when set", () => {
    expect(toTask(action({}), undefined, "UTC")).not.toHaveProperty("projectId");
    expect(
      toTask(
        action({
          project_item_id: "p1",
          timeframe: "this_week",
          context: "Aus dem Sync",
          exported_at: "2026-11-01T10:00:00Z",
          external_ref: "griply:42",
        }),
        undefined,
        "UTC",
      ),
    ).toMatchObject({
      projectId: "p1",
      timeframe: "this_week",
      context: "Aus dem Sync",
      exportedAt: "2026-11-01T10:00:00Z",
      externalRef: "griply:42",
    });
  });

  it("standalone and manual tasks: no due, not AI", () => {
    expect(toTask(action({}), undefined, "UTC")).toMatchObject({
      due: "",
      sourceId: "",
      ai: false,
      tag: "",
    });
    expect(
      toTask(
        action({ source_item_id: "n1", description: MANUAL_TASK_MARK }),
        item({ id: "n1", type: "note" }),
        "UTC",
      ).ai,
    ).toBe(false);
    expect(
      toTask(action({ due_date: "2026-10-23T00:00:00Z" }), undefined, "UTC").dueTime,
    ).toBeUndefined();
  });
});

describe("inbox review", () => {
  it("takes recent processed items the organizer was unsure about, not manual/objects/daily/old/in-flight ones", () => {
    const today = "2026-10-23";
    const unsure = { placement: { confidence: 0.4, review: false, folderPath: "30_Clippings" } };
    expect(isReviewCandidate(item(unsure), today)).toBe(true);
    // zero-setup: confident or unknown placements are filed without review
    expect(
      isReviewCandidate(
        item({ placement: { confidence: 0.9, review: false, folderPath: null } }),
        today,
      ),
    ).toBe(false);
    expect(isReviewCandidate(item({}), today)).toBe(false);
    // the user's threshold decides, and "Prüfen" always brings it back
    expect(
      isReviewCandidate(
        item({ placement: { confidence: 0.9, review: false, folderPath: null } }),
        today,
        0.95,
      ),
    ).toBe(true);
    expect(
      isReviewCandidate(
        item({ placement: { confidence: 0.9, review: true, folderPath: null } }),
        today,
      ),
    ).toBe(true);
    expect(isReviewCandidate(item({ ...unsure, manualPlacement: true }), today)).toBe(false);
    expect(isReviewCandidate(item({ ...unsure, status: "processing" }), today)).toBe(false);
    expect(isReviewCandidate(item({ ...unsure, type: "person" }), today)).toBe(false);
    expect(
      isReviewCandidate(item({ ...unsure, path: "10_Notes/Daily/2026-10-23.md" }), today),
    ).toBe(false);
    expect(isReviewCandidate(item({ ...unsure, date: "2026-09-01" }), today)).toBe(false);
  });

  it("builds a proposal from the item: folder as target, host as source, linked titles", () => {
    const p = toProposal(item({ links: ["x", "gone"], cover: "https://img/1.webp" }), (id) =>
      id === "x" ? "Hyrox Plan" : undefined,
    );
    expect(p).toMatchObject({
      id: "i1",
      itemId: "i1",
      target: "30_Clippings",
      source: "Artikel · example.com",
      links: ["Hyrox Plan"],
      coverUrl: "https://img/1.webp",
      tags: ["#fitness/zone2"],
    });
  });

  it("offers vault folders without inbox, daily, objects and digests", () => {
    const t = inboxTargets([
      { id: "1", name: "00_Inbox", path: "00_Inbox", depth: 0 },
      { id: "2", name: "10_Notes", path: "10_Notes", depth: 0 },
      { id: "3", name: "Daily", path: "10_Notes/Daily", depth: 1 },
      { id: "4", name: "People", path: "70_Objects/People", depth: 1 },
      { id: "5", name: "Rezepte", path: "50_Recipes", depth: 0 },
    ]);
    expect(t.map((x) => x.path)).toEqual(["10_Notes", "50_Recipes"]);
    expect(t[1]).toMatchObject({ icon: "recipe", label: "50_Recipes" });
  });
});

describe("journal stats", () => {
  it("counts the streak up to today, or up to yesterday before today's note exists", () => {
    expect(dailyStreak(["2026-10-23", "2026-10-22", "2026-10-20"], "2026-10-23")).toBe(2);
    expect(dailyStreak(["2026-10-22", "2026-10-21"], "2026-10-23")).toBe(2);
    expect(dailyStreak([], "2026-10-23")).toBe(0);
  });

  it("marks the week Mon..Sun", () => {
    // 2026-10-23 is a Friday.
    expect(weekStrip(["2026-10-19", "2026-10-21"], "2026-10-23")).toEqual([
      "is-done",
      "",
      "is-done",
      "",
      "is-today",
      "",
      "",
    ]);
  });

  it("scales the heat map to the busiest day", () => {
    const h = activityHeat({ "2026-10-23": 4, "2026-10-22": 1 }, "2026-10-23");
    expect(h).toHaveLength(84);
    expect(h[83]).toBe(100);
    expect(h[82]).toBe(25);
    expect(h[0]).toBe(0);
  });
});
