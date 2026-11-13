import { describe, expect, it } from "vitest";
import {
  buildMonth,
  buildWeek,
  clockOf,
  collectionDensity,
  collectionScope,
  domainOf,
  fieldValue,
  filterTags,
  isoWeek,
  lengthOf,
  linkIndex,
  matchesType,
  monogram,
  objectColumns,
  objectStatusTone,
  progressOf,
  sortEntries,
  sparkPath,
  sparkSeries,
  statusOf,
  tagIndex,
  taskCountOf,
  typeChips,
  TYPE_FILTERS,
  visualOf,
  weekStart,
} from "./collections";
import { CONTENT_TYPES } from "@/lib/spaces";

describe("source line", () => {
  it("takes the host of http(s) URLs only", () => {
    expect(domainOf("https://www.inkandswitch.com/local-first/")).toBe("inkandswitch.com");
    expect(domainOf("http://youtube.com/watch?v=1")).toBe("youtube.com");
    expect(domainOf("file:///C:/x.pdf")).toBeUndefined();
    expect(domainOf("kein link")).toBeUndefined();
    expect(domainOf(null)).toBeUndefined();
  });

  it("formats media clocks", () => {
    expect(clockOf(2530)).toBe("42:10");
    expect(clockOf(4324)).toBe("1:12:04");
    expect(clockOf(58)).toBe("0:58");
  });

  it("prefers duration, then pages, then reading minutes, and leaves it out without data", () => {
    expect(lengthOf({ duration_sec: 134 })).toEqual({ label: "2:14", clock: true });
    expect(lengthOf({ reading_minutes: 14 }, 530)).toEqual({ label: "530 Seiten", clock: false });
    expect(lengthOf({ reading_minutes: 13.6 })).toEqual({ label: "14 Min.", clock: false });
    expect(lengthOf({})).toBeUndefined();
    expect(lengthOf(undefined)).toBeUndefined();
  });

  it("shows reading progress only while a medium is started", () => {
    expect(progressOf({ progress: 0.6 })).toBe(0.6);
    expect(progressOf({ progress: 1 })).toBeUndefined();
    expect(progressOf({ progress: 0 })).toBeUndefined();
    expect(progressOf(null)).toBeUndefined();
  });

  it("maps the pipeline status to a pill", () => {
    expect(statusOf("inbox")).toEqual({ label: "Neu", tone: "new" });
    expect(statusOf("processed")).toEqual({ label: "Verarbeitet", tone: "ok" });
    expect(statusOf("processed", 0.6)).toEqual({ label: "Gelesen 60 %", tone: "run" });
    expect(statusOf(undefined)).toBeUndefined();
  });

  it("counts done and total action items", () => {
    expect(taskCountOf([{ done: true }, { done: false }, { done: false }])).toEqual([1, 3]);
    expect(taskCountOf([])).toBeUndefined();
  });
});

describe("monochrome placeholder", () => {
  it("uses an own raster image and the type glyph otherwise", () => {
    expect(visualOf("https://img.example/a.jpg", "article")).toEqual({ kind: "image", src: "https://img.example/a.jpg" });
    expect(visualOf(null, "meeting")).toEqual({ kind: "placeholder", glyph: "mic" });
    expect(visualOf(undefined, "unbekannt")).toEqual({ kind: "placeholder", glyph: "file-text" });
  });

  it("never blows up an SVG logo or pack tile as a cover", () => {
    expect(visualOf("/theme-packs/origami/dark/recipes-tile.svg", "recipe")).toEqual({ kind: "placeholder", glyph: "chef-hat" });
  });
});

describe("density", () => {
  it("names the scopes like the plan", () => {
    expect(collectionScope("spaces", "all")).toBe("spaces:all");
    expect(collectionScope("objects", "person")).toBe("objects:person");
    expect(collectionScope("hashtags")).toBe("hashtags");
    expect(collectionScope("inbox", "x")).toBe("inbox");
  });

  it("defaults to kompakt, keeps the user's choice and shows dicht while the drawer is open", () => {
    expect(collectionDensity({})).toBe("kompakt");
    expect(collectionDensity({ chosen: "komfort" })).toBe("komfort");
    expect(collectionDensity({ chosen: "komfort", drawerOpen: true })).toBe("dicht");
    expect(collectionDensity({ global: "komfort" })).toBe("komfort");
  });
});

describe("week calendar", () => {
  const entries = [
    { id: "a", date: "2026-10-29", time: "09:12", title: "A" },
    { id: "b", date: "2026-10-29", time: "07:55", title: "B" },
    { id: "c", date: "2026-10-26", time: "10:00", title: "C" },
    { id: "d", date: "2026-11-02", time: "10:00", title: "nächste Woche" },
  ];
  const plans = [
    { id: "t1", due: "2026-10-30", title: "Preis-Hypothese testen" },
    { id: "t2", due: "2026-10-31", title: "erledigt", done: true },
  ];

  it("starts on Monday and knows the ISO week", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(isoWeek("2026-10-29")).toBe(44);
  });

  it("collects the entries per day, earliest first, plus open tasks", () => {
    const w = buildWeek(entries, plans, "2026-10-29", "2026-10-29");
    expect(w.title).toBe("26. Okt. bis 1. Nov.");
    expect(w.kw).toBe(44);
    expect(w.count).toBe(3);
    expect(w.days.map((d) => d.dow)).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
    const thu = w.days[3]!;
    expect(thu.today).toBe(true);
    expect(thu.entries.map((e) => e.id)).toEqual(["b", "a"]);
    expect(w.days[4]!.planned.map((p) => p.id)).toEqual(["t1"]);
    expect(w.days[5]!.planned).toEqual([]);
  });

  it("titles a week inside one month without repeating it", () => {
    expect(buildWeek([], [], "2026-10-14", "2026-10-29").title).toBe("12. bis 18. Okt.");
  });

  it("builds whole weeks for the month view", () => {
    const m = buildMonth(entries, "2026-10-29", "2026-10-29");
    expect(m.title).toBe("Oktober 2026");
    expect(m.cells.length % 7).toBe(0);
    expect(m.cells[0]!.date).toBe("2026-09-28");
    expect(m.cells.find((c) => c.date === "2026-10-29")).toMatchObject({ count: 2, today: true, inMonth: true });
  });

  it("keeps done tasks (after the open ones) when the calendar can toggle them", () => {
    const more = [...plans, { id: "t3", due: "2026-10-31", title: "offen" }];
    const w = buildWeek(entries, more, "2026-10-29", "2026-10-29", { withDone: true });
    expect(w.days[5]!.planned.map((p) => p.id)).toEqual(["t3", "t2"]);
    expect(buildWeek(entries, more, "2026-10-29", "2026-10-29").days[5]!.planned.map((p) => p.id)).toEqual(["t3"]);
  });

  it("lists entries and tasks per month cell for the dot row", () => {
    const m = buildMonth(entries, "2026-10-29", "2026-10-29", plans);
    const thu = m.cells.find((c) => c.date === "2026-10-29")!;
    expect(thu.entries.map((e) => e.id)).toEqual(["b", "a"]);
    expect(m.cells.find((c) => c.date === "2026-10-31")!.planned.map((p) => p.id)).toEqual(["t2"]);
    expect(buildMonth(entries, "2026-10-29", "2026-10-29").cells.every((c) => c.planned.length === 0)).toBe(true);
  });
});

describe("hashtag index", () => {
  const today = "2026-10-29";
  const entries = [
    { id: "n1", date: "2026-10-29", tags: ["#ai/mcp", "#kortex"] },
    { id: "n2", date: "2026-10-28", tags: ["#ai/agents"] },
    { id: "n3", date: "2026-10-28", tags: ["#ai/mcp"] },
    { id: "n4", date: "2026-08-01", tags: ["#AI"] },
  ];
  const objects = [{ id: "o1", date: "2026-10-01", tags: ["#ai/mcp"] }];

  it("counts per day over 30 days from real timestamps (oldest first)", () => {
    const s = sparkSeries(["2026-10-29", "2026-10-29", "2026-09-30", "2026-09-29"], today);
    expect(s).toHaveLength(30);
    expect(s[29]).toBe(2);
    expect(s[0]).toBe(1);
    expect(s.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("draws a path inside the box, flat for no data", () => {
    const p = sparkPath([0, 0, 0], 90, 22);
    expect(p.line.startsWith("M0.0 20.0")).toBe(true);
    expect(p.last[0]).toBe(90);
    expect(sparkPath([0, 4], 90, 22).last[1]).toBeLessThan(5);
  });

  it("groups by the first path segment with children and linked objects", () => {
    const groups = tagIndex(entries, objects, new Map([["n2", ["o2"]]]), today);
    const ai = groups.find((g) => g.tag === "ai")!;
    expect(groups[0]!.tag).toBe("ai");
    expect(ai.count).toBe(4);
    expect(ai.children.map((c) => [c.tag, c.name, c.count])).toEqual([
      ["ai/mcp", "mcp", 2],
      ["ai/agents", "agents", 1],
    ]);
    expect(ai.objects.sort()).toEqual(["o1", "o2"]);
    expect(ai.series.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("filters groups and children inline", () => {
    const groups = tagIndex(entries, objects, new Map(), today);
    expect(filterTags(groups, "#agen").map((g) => [g.tag, g.children.map((c) => c.tag)])).toEqual([["ai", ["ai/agents"]]]);
    expect(filterTags(groups, "kortex").map((g) => g.tag)).toEqual(["kortex"]);
    expect(filterTags(groups, "")).toHaveLength(groups.length);
  });
});

describe("objects", () => {
  it("builds monograms", () => {
    expect(monogram("Dr. Louisa Weber")).toBe("LW");
    expect(monogram("Kortex")).toBe("Ko");
    expect(monogram("Sparkasse München")).toBe("SM");
  });

  it("links items and objects in both directions", () => {
    const { objectsOf, itemsOf } = linkIndex(
      [
        { id: "n1", links: ["o1", "n2"] },
        { id: "n2", links: [] },
      ],
      [{ id: "o2", links: ["n2"] }, { id: "o1", links: [] }],
    );
    expect(objectsOf.get("n1")).toEqual(["o1"]);
    expect(objectsOf.get("n2")).toEqual(["o2"]);
    expect(itemsOf.get("o2")).toEqual(["n2"]);
  });

  it("shows only the frontmatter columns some object has", () => {
    const cols = objectColumns("person", [{ metadata: { role: "VP Engineering" } }, { metadata: { role: "Coach", organization: "Team Reiter" } }]);
    expect(cols.map((c) => c.key)).toEqual(["role", "organization"]);
    expect(objectColumns("asset", [{ metadata: {} }])).toEqual([]);
    expect(objectColumns("goal", [{ metadata: { progress_pct: 40 } }]).map((c) => c.label)).toEqual(["Fortschritt"]);
  });

  it("formats field values", () => {
    expect(fieldValue("monthly_value", 1250)).toBe("1.250 €");
    expect(fieldValue("target_date", "2026-12-31")).toBe("31. Dez. 2026");
    expect(fieldValue("priority", "high")).toBe("Hoch");
    expect(fieldValue("role", "  ")).toBeUndefined();
    expect(objectStatusTone("In Arbeit")).toBe("run");
    expect(objectStatusTone("Fertig")).toBe("ok");
  });
});

describe("filter bar", () => {
  it("offers chips only for present types", () => {
    expect(typeChips(["article", "article", "note", "person"])).toEqual([
      { key: "all", label: "Alle", count: 4 },
      { key: "article", label: "Artikel", count: 2 },
      { key: "note", label: "Notizen", count: 1 },
      { key: "object", label: "Objekte", count: 1 },
    ]);
    expect(matchesType("podcast", "audio")).toBe(true);
    expect(matchesType("note", "article")).toBe(false);
  });

  it("derives chips for every registry content type (registry label) and groups format variants", () => {
    expect(typeChips(["movie", "receipt", "receipt", "pdf", "daily_note"])).toEqual([
      { key: "all", label: "Alle", count: 5 },
      { key: "note", label: "Notizen", count: 1 },
      { key: "book", label: "Bücher", count: 1 },
      { key: "movie", label: "Film/Serie", count: 1 },
      { key: "receipt", label: "Beleg", count: 2 },
    ]);
    expect(matchesType("ai_chat", "ai")).toBe(true);
    for (const t of CONTENT_TYPES) expect(TYPE_FILTERS.filter((f) => f.kinds.includes(t)), t).toHaveLength(1);
  });

  it("sorts newest, oldest and by title", () => {
    const l = [
      { date: "2026-10-28", time: "10:00", title: "Beta" },
      { date: "2026-10-29", time: "08:00", title: "Alpha" },
    ];
    expect(sortEntries(l, "newest")[0]!.title).toBe("Alpha");
    expect(sortEntries(l, "oldest")[0]!.title).toBe("Beta");
    expect(sortEntries(l, "title")[0]!.title).toBe("Alpha");
  });
});
