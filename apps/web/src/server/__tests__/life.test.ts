import { describe, expect, it } from "vitest";
import { MOCK_INSIGHTS } from "@/lib/mock/insights";
import { MOCK_REVIEW } from "@/lib/mock/review";
import { activeAreaKeys, areaKeyForLabel, areaOf } from "../life/areas";
import { computeLife } from "../life/compute";
import { addDays, isoWeek, isoWeekKey, mondayOf, weekdayIndex } from "../life/dates";
import { toDailyEntry, type LifeSource, type SourceItem, type SourceTask } from "../life/source";
import { basisLine, computeInsights, streaks } from "../insights/compute";
import {
  needsRefresh,
  toRecommendations,
  IMPULSE_TTL_MS,
  type ImpulseInput,
} from "../insights/impulses";
import { computeReview, firstSentence } from "../review/compute";
import { reviewMarkdown } from "../review/markdown";

const TODAY = "2026-10-22"; // Thursday, KW 43
const at = (date: string, h = 10) => `${date}T${String(h).padStart(2, "0")}:00:00.000Z`;

let n = 0;
const item = (over: Partial<SourceItem>): SourceItem => ({
  id: `i${++n}`,
  type: "note",
  title: `Item ${n}`,
  summary: null,
  tags: [],
  cluster: null,
  folder: "10_Notes",
  slug: `item-${n}`,
  status: "processed",
  manual: false,
  platform: "web",
  created: at(TODAY),
  updated: at(TODAY),
  metadata: {},
  ...over,
});
const task = (over: Partial<SourceTask>): SourceTask => ({
  id: `t${++n}`,
  title: `Task ${n}`,
  done: false,
  due: null,
  completed: null,
  created: at(addDays(TODAY, -3)),
  sourceItemId: null,
  priority: "medium",
  ...over,
});
const day = (date: string, energy: number | null, mob: boolean) =>
  toDailyEntry(date, {
    checkin: {
      energy,
      habits: [
        { key: "mob", label: "Morning Mobility", done: mob },
        { key: "carb", label: "Low-Carb Fokus", done: false },
      ],
      focus: [{ key: "a", text: "x", done: true }],
    },
  });

const empty = (over: Partial<LifeSource> = {}): LifeSource => ({
  today: TODAY,
  timeZone: "Europe/Berlin",
  items: [],
  goals: [],
  tasks: [],
  dailies: [],
  digests: [],
  areaLabels: [],
  ...over,
});

describe("dates", () => {
  it("ISO weeks and Monday-based weekdays", () => {
    expect(weekdayIndex(TODAY)).toBe(3);
    expect(mondayOf(TODAY)).toBe("2026-10-19");
    expect(isoWeek(TODAY)).toEqual({ year: 2026, week: 43 });
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
  });
});

describe("life areas: mapping", () => {
  it("explicit tag or metadata wins, then keywords in tags, cluster and folder", () => {
    expect(areaOf(item({ tags: ["life/finance", "fitness"] }))).toBe("finance");
    expect(areaOf(item({ tags: ["area/Health & Fitness"] }))).toBe("health");
    expect(areaOf(item({ metadata: { life_area: "Ventures" } }))).toBe("ventures");
    expect(areaOf(item({ tags: ["sport/hyrox"] }))).toBe("health");
    expect(areaOf(item({ cluster: "MBA Strategie" }))).toBe("career");
    expect(areaOf(item({ tags: ["random"] }))).toBeNull();
  });

  it("onboarding labels choose the active areas (all six without a choice)", () => {
    expect(areaKeyForLabel("Beziehungen & Familie")).toBe("relations");
    expect(activeAreaKeys(["Health & Fitness", "Ventures", "Freizeit & Abenteuer"])).toEqual([
      "health",
      "ventures",
    ]);
    expect(activeAreaKeys([])).toHaveLength(6);
  });
});

describe("computeLife", () => {
  it("a fresh account: every area empty, score 0, helpful texts, no signals", () => {
    const life = computeLife(empty({ areaLabels: ["Health & Fitness"] }));
    expect(life.today).toBe(3);
    expect(life.areas.map((a) => [a.key, a.active, a.empty, a.score])).toEqual([
      ["health", true, true, 0],
      ["career", false, true, 0],
      ["finance", false, true, 0],
      ["ventures", false, true, 0],
      ["relations", false, true, 0],
      ["growth", false, true, 0],
    ]);
    expect(life.areas[0]!.reflect).toContain("#life/health");
    expect(life.areas[0]!.goals).toEqual([]);
    expect(life.signals).toEqual([]);
  });

  it("goals, tasks, routines and energy correlation", () => {
    const goal = item({
      type: "goal",
      title: "Hyrox unter 1:20",
      tags: ["fitness"],
      metadata: { progress_pct: 60, goal_timeframe: "März" },
    });
    const project = item({
      type: "project",
      title: "MFH prüfen",
      tags: ["life/finance"],
      metadata: { project_status: "In Arbeit" },
    });
    const dailies = Array.from({ length: 10 }, (_, i) =>
      day(addDays(TODAY, i - 9), i % 2 ? 9 : 6, i % 2 === 1),
    );
    const src = empty({
      goals: [goal, project],
      items: [
        item({ tags: ["sport"], created: at(addDays(TODAY, -1)) }),
        item({
          tags: ["finanzen"],
          created: at(addDays(TODAY, -12)),
          updated: at(addDays(TODAY, -12)),
        }),
      ],
      tasks: [
        task({ title: "Sled-Technik", sourceItemId: goal.id, due: addDays(TODAY, -1) }),
        task({
          title: "Checkliste",
          sourceItemId: project.id,
          done: true,
          completed: at(addDays(TODAY, -2)),
        }),
      ],
      dailies,
    });
    const life = computeLife(src);
    const health = life.areas.find((a) => a.key === "health")!;
    expect(health.goals).toEqual([
      {
        t: "Hyrox unter 1:20",
        due: "März",
        pct: 60,
        next: "Nächster Schritt: Sled-Technik (überfällig)",
      },
    ]);
    expect(health.routines.map((r) => r.t)).toEqual(["Morning Mobility"]);
    expect(health.routines[0]!.d.slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(health.reflect).toMatch(
      /Morning Mobility liegt Deine Energie im Schnitt 3,0 Punkte höher/,
    );
    expect(health.empty).toBe(false);
    expect(health.score).toBeGreaterThan(0);
    const finance = life.areas.find((a) => a.key === "finance")!;
    expect(finance.goals[0]).toMatchObject({ t: "MFH prüfen", pct: 100 }); // its only task is done
    expect(finance.metrics.find((m) => m.l === "Tage seit Eintrag")?.v).toBe("0");
    expect(life.signals.map((s) => s.key)).toContain("health");
    // Ranges: the 30-day window is the area score; picks list the open goal first.
    expect(health.ranges?.[30].score).toBe(health.score);
    expect(health.picks?.[0]).toEqual({ id: goal.id, title: "Hyrox unter 1:20", type: "goal" });
    expect(finance.picks?.map((p) => p.type)).toEqual(["note"]); // the project is done (100 %)
  });

  it("ranges score 7/30/90 days with the window before as trend base", () => {
    // Health: an entry every second day in the last 30 days, a mobility habit done every day this week only.
    const items = Array.from({ length: 15 }, (_, i) =>
      item({ tags: ["sport"], created: at(addDays(TODAY, -2 * i)), updated: at(addDays(TODAY, -2 * i)) }),
    );
    const dailies = Array.from({ length: 14 }, (_, i) => day(addDays(TODAY, i - 13), 7, i >= 7));
    const life = computeLife(empty({ items, dailies }));
    const health = life.areas.find((a) => a.key === "health")!;
    const r = health.ranges!;
    expect(r[7].score).not.toBeNull();
    // Last 7 days: habit every day, 4 entries of 3 needed → full marks for both parts.
    expect(r[7].score).toBe(100);
    // The 7 days before: no habit done, entries still there → lower.
    expect(r[7].prev).toBeLessThan(r[7].score!);
    // 90 days: the window before has no data at all.
    expect(r[90].prev).toBeNull();
    expect(health.score).toBe(r[30].score);
    // An area without any data has no score in any range.
    const career = life.areas.find((a) => a.key === "career")!;
    expect(career.ranges![30]).toEqual({ score: null, prev: null });
    expect(career.picks).toEqual([]);
  });
});

describe("computeInsights", () => {
  it("activity, auto share, energy, streak, spaces and sources", () => {
    const items = [
      item({ created: at(TODAY), type: "article", platform: "web" }),
      item({ created: at(addDays(TODAY, -1)), manual: true, type: "note", platform: "manual" }),
      item({ created: at(addDays(TODAY, -40)), type: "meeting", platform: "teams_wasapi" }),
    ];
    const dailies = [
      day(addDays(TODAY, -1), 7, true),
      day(TODAY, 9, false),
      day(addDays(TODAY, -8), 5, true),
    ];
    const vault = [
      ...items.map((i) => ({ type: i.type, platform: i.platform })),
      { type: "daily_note", platform: "manual" },
    ];
    const d = computeInsights(empty({ items, dailies }), vault, new Date(at(TODAY)));
    expect(d.activity).toHaveLength(180);
    expect(d.activity.at(-1)).toEqual({ date: TODAY, v: 1 });
    expect(d.autoPct[7]).toBe(50);
    expect(d.energy.at(-1)).toMatchObject({ date: TODAY, v: 9, habit: false });
    expect(d.habitLabel).toBe("Morning Mobility");
    expect(d.energyAvg).toBe("8,0");
    expect(d.energyDelta).toBe(3);
    expect(d.streak).toBe(2);
    expect(d.spaces).toEqual([
      { label: "Artikel", g: "auto", v: 1 },
      { label: "Notizen", g: "ai", v: 1 },
      { label: "Meetings", g: "auto", v: 1 },
    ]);
    expect(d.sources.map((s) => s.label)).toEqual([
      "Web & Extension",
      "Selbst geschrieben",
      "Desktop HUD",
    ]);
    expect(d.habitHeat).toHaveLength(84);
    expect(basisLine(d.counts, null, "Europe/Berlin")).toBe(
      "Abgeleitet aus 3 Einträgen und 1 Meeting.",
    );
  });

  it("an empty vault has nulls and empty lists, not fake numbers", () => {
    const d = computeInsights(empty(), [], new Date(at(TODAY)));
    expect(d.autoPct).toEqual({ 7: null, 30: null, 90: null });
    expect(d.energyAvg).toBeNull();
    expect(d.habitHeat).toBeNull();
    expect(d.lead).toBeNull();
    expect(d.spaces).toEqual([]);
    expect(d.sources).toEqual([]);
  });

  it("streak record", () => {
    const ds = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-21", "2026-10-22"].map((x) =>
      day(x, 5, false),
    );
    expect(streaks(ds, TODAY)).toEqual({ streak: 2, record: 3 });
  });

  it("the mock data still renders the prototype values", () => {
    expect(MOCK_INSIGHTS.activity).toHaveLength(90);
    expect(
      MOCK_INSIGHTS.top.every((k) => MOCK_INSIGHTS.recommendations.some((r) => r.k === k)),
    ).toBe(true);
  });
});

describe("impulses", () => {
  const input: ImpulseInput = {
    items: [{ id: "a1", type: "meeting", title: "Q4-Sync", tags: [] }],
    tasks: [],
    topTags: [],
    areas: [],
    energy: { avg: null, days: 0 },
  };

  it("keeps only known item ids and area keys and fills the top picks", () => {
    const out = toRecommendations(
      {
        recommendations: [
          {
            cat: "meetings",
            title: "Q4 vorbereiten",
            text: "t",
            why: "w",
            cta: "Vorbereiten",
            item_id: "a1",
          },
          {
            cat: "links",
            title: "Verbindung",
            text: "t",
            why: "w",
            cta: "Ansehen",
            item_id: "invented",
          },
          {
            cat: "personal",
            title: "Mobility",
            text: "t",
            why: "w",
            cta: "Öffnen",
            life_area: "health",
          },
          {
            cat: "books",
            title: "Ein Buch",
            meta: "A. Autor · Buch",
            text: "t",
            why: "w",
            cta: "Auf Leseliste",
          },
        ],
        top: [3, 3, 9],
      },
      input,
    );
    expect(out.recommendations.map((r) => r.fn)).toEqual([
      { kind: "note", id: "a1" },
      { kind: "graph" },
      { kind: "life", key: "health" },
      undefined,
    ]);
    expect(out.recommendations[3]!.cover).toMatchObject({
      kind: "book",
      title: "Ein Buch",
      sub: "A. Autor",
    });
    expect(out.top).toEqual(["r4", "r1", "r2"]);
  });

  it("refreshes after 24 h, or after 2 h when the inputs changed", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    expect(needsRefresh(null, "h", now)).toBe(true);
    expect(needsRefresh({ at: ago(60_000), hash: "h" }, "h", now)).toBe(false);
    expect(needsRefresh({ at: ago(60_000), hash: "old" }, "h", now)).toBe(false);
    expect(needsRefresh({ at: ago(3 * 3600_000), hash: "old" }, "h", now)).toBe(true);
    expect(needsRefresh({ at: ago(IMPULSE_TTL_MS + 1), hash: "h" }, "h", now)).toBe(true);
  });
});

describe("computeReview", () => {
  it("fresh account: honest empty week", () => {
    const src = empty();
    const r = computeReview(src, computeLife(src));
    expect(r.review).toMatchObject({
      title: "Wochen-Review KW 43",
      week: "KW 43",
      prevWeek: "KW 42",
      nextWeek: "KW 44",
      file: "10_Notes/Weekly/2026-W43.md",
      isoWeek: "2026-W43",
    });
    expect(r.review.eyebrow).toBe("Ritual · Donnerstag, 22. Oktober · rund 12 Minuten");
    expect(r.review.summary).toMatch(/noch nichts im Vault/);
    expect(r.stats.map((s) => s.v)).toEqual(["0", "0", "–", "0"]);
    expect(r.focus).toEqual([]);
    expect(r.balance).toHaveLength(6);
    expect(r.review.balanceNote).toMatch(/Noch keine Daten/);
  });

  it("week numbers, open tasks, focus picks, next week and digest headlines", () => {
    const meeting = item({
      type: "meeting",
      title: "Q4-Sync",
      summary: "Protokoll",
      tags: ["kortex"],
    });
    const digest = item({
      type: "digest",
      title: "Weekly Digest KW 43/2026 · Kortex",
      summary: "Die Sync-Konflikte sind entschieden",
      metadata: { group: "Kortex", iso_week: "KW 43/2026", period_start: at("2026-10-15") },
    });
    const src = empty({
      items: [
        meeting,
        item({ tags: ["kortex"] }),
        item({ created: at(addDays(TODAY, -10)), updated: at(addDays(TODAY, -10)) }),
      ],
      tasks: [
        task({
          title: "Checksum an Sven",
          due: addDays(TODAY, -1),
          sourceItemId: meeting.id,
          priority: "high",
        }),
        task({ title: "Deep Work", due: "2026-10-27" }),
        task({ title: "Erledigt", done: true, completed: at(TODAY) }),
      ],
      dailies: [day("2026-10-20", 8, true), day("2026-10-21", 6, false)],
      digests: [digest],
    });
    const r = computeReview(src, computeLife(src));
    expect(r.review.summary).toBe("Die Sync-Konflikte sind entschieden.");
    expect(r.stats.map((s) => s.v)).toEqual(["2", "1", "7,0", "1"]);
    expect(r.stats[1]!.l).toBe("Meeting, 1 mit Protokoll");
    expect(r.highlights[0]).toEqual({ t: "Q4-Sync", id: meeting.id });
    expect(r.open.map((o) => o.t)).toEqual(["Checksum an Sven"]);
    expect(r.focus.map((f) => [f.t, f.area, f.on])).toEqual([
      ["Checksum an Sven", "Ventures", true],
      ["Deep Work", "Aufgabe", true],
    ]);
    expect(r.week[0]).toEqual({ d: "Mo", items: [] });
    expect(r.week[1]).toEqual({ d: "Di", items: [{ t: "Deep Work", cls: "" }] });
    expect(r.digests[0]).toMatchObject({ group: "Kortex", week: "KW 43/2026" });
    expect(r.questions[1]![1]).toContain("Checksum an Sven");
  });

  it("summary sentences", () => {
    expect(firstSentence("Die Woche war gut. Danach kam mehr.")).toBe("Die Woche war gut.");
    expect(firstSentence("Kein Punkt am Ende")).toBe("Kein Punkt am Ende.");
    expect(firstSentence("Version 2.0 ist da. Rest.")).toBe("Version 2.0 ist da.");
  });

  it("the review note is clean Markdown with frontmatter", () => {
    const md = reviewMarkdown(
      {
        isoWeek: "2026-W43",
        title: "Wochen-Review KW 43",
        summary: "S.",
        answers: [{ q: "Was?", a: "" }],
        focus: [{ t: "A", area: "Health", on: true }],
      },
      TODAY,
    );
    expect(md).toContain(
      "---\ntype: weekly_review\nweek: 2026-W43\ndate: 2026-10-22\ntags: [weekly-review]\n---",
    );
    expect(md).toContain("### Was?\n\n_(offen)_");
    expect(md).toContain("- [ ] A (Health)");
    expect(MOCK_REVIEW.focus.filter((f) => f.on)).toHaveLength(3);
  });
});
