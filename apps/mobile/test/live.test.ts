import { describe, expect, it } from "vitest";
import { inboxOf, itemToEntry, itemsToEntries, lifeToAreas, plain, pointsOf, shortDay, toneOfTag, typeIconOf, typeLabel, type ItemRow } from "../src/data/live";
import { citedSources, parseChatStream } from "../src/api/chatStream";

const art = (key: string) => ({ uri: `art:${key}` });
const now = new Date(2026, 9, 24, 15, 0);
const at = (daysBack: number, h = 9) => new Date(2026, 9, 24 - daysBack, h, 5).toISOString();

const row = (over: Partial<ItemRow> = {}): ItemRow => ({
  id: "i1",
  type: "article",
  title: "Contextual Retrieval",
  summary: "Chunks **brauchen** Kontext.",
  content_md: "# Titel\n- Menü\n## Kernpunkte\n- Punkt eins\n- [x] Punkt zwei\n",
  tags: ["ai/agents"],
  status: "processed",
  folder_path: "30_Clippings/Web",
  cover_image_url: null,
  metadata: null,
  entities: ["Sven"],
  created_at: at(0),
  updated_at: at(0, 10),
  ...over,
});

describe("items → entries", () => {
  it("maps type, tag, tldr, points and time", () => {
    const e = itemToEntry(row(), now, art);
    expect(e).toMatchObject({ id: "i1", kind: "read", type: "Artikel", tag: "#ai/agents", tldr: "Chunks brauchen Kontext.", day: 0, who: ["Sven"], whenShort: "Heute", time: "09:05" });
    expect(e.points).toEqual(["Punkt eins", "Punkt zwei"]);
    // No cover: the type tile of the active theme pack (article -> articles), resolved when drawn.
    expect(e.img).toEqual({ pack: "articles" });
  });

  it("uses the cover, the folder as fallback tag and metadata.key_points", () => {
    const e = itemToEntry(row({ cover_image_url: "https://x/c.jpg", tags: [], metadata: { key_points: ["A", 3, "B"] } }), now, art);
    expect(e.img).toEqual({ uri: "https://x/c.jpg" });
    expect(e.tag).toBe("#web");
    expect(e.points).toEqual(["A", "B"]);
  });

  it("ranks opened by updated_at and newer entries get a lower ts", () => {
    const [a, b] = itemsToEntries([row({ id: "a", created_at: at(2), updated_at: at(0) }), row({ id: "b", created_at: at(0), updated_at: at(1) })], now, art);
    expect(a!.opened).toBe(0);
    expect(b!.opened).toBe(1);
    expect(b!.ts).toBeLessThan(a!.ts);
  });

  it("formats days", () => {
    expect(shortDay(at(1), now)).toBe("Gestern");
    expect(shortDay(at(10), now)).toBe("14.10.");
  });

  it("strips markdown", () => {
    expect(plain("---\na: 1\n---\n## Hi [[Note|x]] and [link](http://a)")).toBe("Hi Note and link");
    expect(pointsOf({ metadata: null, content_md: "no bullets" })).toEqual([]);
  });

  it("tones tags by domain", () => {
    expect(toneOfTag("#fitness/hyrox")).toBe("health");
    expect(toneOfTag("#real-estate")).toBe("finance");
    expect(toneOfTag("#whatever")).toBe("ai");
  });
});

describe("inbox", () => {
  it("splits pending jobs from what was filed today", () => {
    const { jobs, processed } = inboxOf(
      [
        row({ id: "p", status: "processing", created_at: new Date(now.getTime() - 60_000).toISOString() }),
        row({ id: "e", status: "error" }),
        row({ id: "d", status: "processed", updated_at: at(0) }),
        row({ id: "old", status: "processed", updated_at: at(3) }),
      ],
      now,
    );
    expect(jobs.map((j) => [j.id, j.failed])).toEqual([["p", false], ["e", true]]);
    expect(jobs[0]!.pct).toBe(40);
    expect(processed).toEqual([{ id: "d", title: "Contextual Retrieval", space: "Clippings", read: false, pinned: false }]);
  });

  it("holds unsure placements for review like the web (not manual, no daily, no object, 14 days)", () => {
    const unsure = { placement: { confidence: 0.4, folder_path: "30_Clippings/Web" } };
    const { review, processed } = inboxOf(
      [
        row({ id: "r", status: "processed", created_at: at(1), updated_at: at(0), metadata: unsure, tags: ["ai"] }),
        row({ id: "sure", status: "processed", created_at: at(1), metadata: { placement: { confidence: 0.9 } } }),
        row({ id: "manual", status: "processed", created_at: at(1), metadata: unsure, is_manual_placement: true }),
        row({ id: "flag", status: "processed", created_at: at(1), metadata: { placement: { confidence: 0.95, review: true } } }),
        row({ id: "daily", status: "processed", created_at: at(1), folder_path: "10_Notes/Daily", metadata: unsure }),
        row({ id: "obj", type: "person", status: "processed", created_at: at(1), metadata: unsure }),
        row({ id: "old", status: "processed", created_at: at(20), metadata: unsure }),
      ],
      now,
    );
    expect(review.map((r) => r.id)).toEqual(["r", "flag"]);
    expect(review[0]).toMatchObject({ target: "30_Clippings/Web", tags: ["ai"] });
    expect(processed.map((p) => p.id)).not.toContain("r");
    expect(inboxOf([row({ id: "x", status: "processed", created_at: at(1), metadata: { placement: { confidence: 0.9 } } })], now, 1).review).toHaveLength(1);
  });

  it("carries Gelesen (metadata.read_at) and Markiert (is_pinned)", () => {
    const { processed } = inboxOf([row({ id: "r", status: "processed", updated_at: at(0), metadata: { read_at: at(0) }, is_pinned: true })], now);
    expect(processed[0]).toMatchObject({ id: "r", read: true, pinned: true });
  });
});

describe("life", () => {
  it("keeps active areas, prefers stored visions and averages scored areas", () => {
    const areas = lifeToAreas(
      {
        areas: [
          { key: "health", name: "Health", tone: "health", img: "runner", score: 80, vision: "v", goals: [{ t: "Hyrox", pct: 50 }] },
          { key: "finance", name: "Finanzen", tone: "finance", img: "stones", score: 40, vision: "", goals: [] },
          { key: "growth", name: "Wachstum", tone: "strategy", img: "journal", score: 0, vision: "", goals: [], empty: true },
          { key: "career", name: "Karriere", tone: "strategy", img: "skyline", score: 90, vision: "", goals: [], active: false },
        ],
        visions: { finance: "Rücklagen" },
      },
      art,
    );
    expect(areas.map((a) => a.key)).toEqual(["health", "finance", "growth"]);
    expect(areas[0]!.goals).toEqual([["Hyrox", 50]]);
    expect(areas[1]!.vision).toBe("Rücklagen");
  });
});

describe("chat stream", () => {
  const sse = [
    'data: {"type":"start"}',
    'data: {"type":"data-citations","data":{"mode":"brain","model":"m","citations":[{"n":1,"item_id":"a","title":"A","snippet":"x"},{"n":2,"item_id":"b","title":"B"}]}}',
    'data: {"type":"text-delta","id":"t","delta":"Kontext hilft "}',
    'data: {"type":"text-delta","id":"t","delta":"[2]."}',
    "data: not json",
    "data: [DONE]",
  ].join("\n\n");

  it("collects text and citations", () => {
    const a = parseChatStream(sse);
    expect(a.text).toBe("Kontext hilft [2].");
    expect(a.citations).toEqual([{ n: 1, item_id: "a", title: "A" }, { n: 2, item_id: "b", title: "B" }]);
    expect(citedSources(a).map((c) => c.item_id)).toEqual(["b"]);
  });

  it("parses chunks that split lines mid-way", async () => {
    const { createChatStreamParser } = await import("../src/api/chatStream");
    const p = createChatStreamParser();
    const cut = sse.indexOf("Kontext") + 3;
    expect(p.push(sse.slice(0, cut)).text).toBe("");
    expect(p.push(sse.slice(cut)).text).toBe("Kontext hilft [2].");
    expect(p.end().citations).toHaveLength(2);
  });

  it("reports stream errors", () => {
    expect(parseChatStream('data: {"type":"error","errorText":"Budget erreicht"}').error).toBe("Budget erreicht");
  });
});

describe("objects", () => {
  it("maps domain objects and lists their properties", async () => {
    const { propsOf } = await import("../src/data/live");
    const e = itemToEntry(row({ type: "person", metadata: { role: "CTO", company_name: "ACME", _internal: "x", tags: ["a"] } }), now, art);
    expect(e.kind).toBe("object");
    expect(e.type).toBe("Person");
    expect(e.points).toEqual(["Role: CTO", "Company name: ACME"]);
    expect(propsOf(null)).toEqual([]);
  });
});

describe("type labels from the registry", () => {
  it("uses @kortex/db labels, also for the new typed types", () => {
    expect(typeLabel("movie")).toBe("Film/Serie");
    expect(typeLabel("receipt")).toBe("Beleg");
    expect(typeLabel("book")).toBe("Buch");
    expect(typeLabel("chat")).toBe("KI-Chat");
    expect(typeLabel("some_new_type")).toBe("Some new type");
    expect(typeIconOf("movie")).toBe("clapperboard");
  });
});
