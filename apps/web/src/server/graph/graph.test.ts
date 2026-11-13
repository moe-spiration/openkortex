import { describe, expect, it } from "vitest";
import { buildGraph, filterItems, mergeEdges, GROUP_MAX, type ItemLite } from "./build";
import { createTtlCache, fingerprint } from "./cache";
import { layoutGraph } from "./layout";
import { graphQueryString, parseGraphQuery } from "./query";
import { DEFAULT_GRAPH_QUERY, KIND_BIT, type GraphQuery } from "./types";

const NOW = new Date("2026-10-23T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString();
const item = (id: string, over: Partial<ItemLite> = {}): ItemLite => ({
  id,
  title: `Item ${id}`,
  type: "note",
  tags: [],
  entities: [],
  related: [],
  updatedAt: day(1),
  ...over,
});
const q = (over: Partial<GraphQuery> = {}): GraphQuery => ({ ...DEFAULT_GRAPH_QUERY, ...over });
const none = { wiki: [], semantic: [] };

describe("query", () => {
  it("round-trips and ignores unknown values", () => {
    const query = q({ types: ["meeting", "note"], domains: ["health", "ai"], sinceDays: 30, semantic: false, limit: 800 });
    expect(parseGraphQuery(new URLSearchParams(graphQueryString(query)))).toEqual(query);
    expect(parseGraphQuery(new URLSearchParams("types=bogus&domain=nope&since=5&limit=3"))).toEqual(DEFAULT_GRAPH_QUERY);
    expect(graphQueryString(DEFAULT_GRAPH_QUERY)).toBe("");
    // A single theme (old links) still parses.
    expect(parseGraphQuery(new URLSearchParams("domain=food")).domains).toEqual(["food"]);
  });

  it("caps the limit", () => {
    expect(parseGraphQuery(new URLSearchParams("limit=999999")).limit).toBe(5000);
  });
});

describe("filters", () => {
  const items = [
    item("a", { type: "meeting", tags: ["#fitness/hyrox"], updatedAt: day(2) }),
    item("b", { type: "note", tags: ["automotive/it"], updatedAt: day(40) }),
    item("c", { type: "person", tags: [], updatedAt: day(1) }),
  ];
  it("filters by type, tag domain and time", () => {
    expect(filterItems(items, q({ types: ["meeting"] }), NOW).map((i) => i.id)).toEqual(["a"]);
    expect(filterItems(items, q({ domains: ["auto"] }), NOW).map((i) => i.id)).toEqual(["b"]);
    expect(filterItems(items, q({ domains: ["auto", "health"] }), NOW).map((i) => i.id)).toEqual(["a", "b"]);
    expect(filterItems(items, q({ sinceDays: 7 }), NOW).map((i) => i.id)).toEqual(["a", "c"]);
    expect(filterItems(items, q(), NOW)).toHaveLength(3);
  });
});

describe("edges", () => {
  it("merges related ids, wiki links and semantic pairs per pair of items", () => {
    const items = [item("a", { related: ["b"] }), item("b", { related: ["a"] }), item("c"), item("d")];
    const edges = mergeEdges(items, { wiki: [["a", "b"], ["c", "d"], ["c", "zzz"]], semantic: [{ a: "a", b: "b", sim: 0.9 }, { a: "b", b: "c", sim: 0.8 }] });
    const byPair = Object.fromEntries(edges.map((e) => [`${e.a}${e.b}`, e.mask]));
    expect(edges).toHaveLength(3);
    expect(byPair.ab).toBe(KIND_BIT.related | KIND_BIT.wiki | KIND_BIT.semantic);
    expect(byPair.cd).toBe(KIND_BIT.wiki);
    expect(byPair.bc).toBe(KIND_BIT.semantic);
  });

  it("chains small tag and entity groups, skips big ones", () => {
    const small = ["a", "b", "c", "d"].map((id, i) => item(id, { tags: ["#kortex"], updatedAt: day(i) }));
    expect(mergeEdges(small, none)).toHaveLength(5); // 4 items, fan-out 2: ab ac bc bd cd
    const big = Array.from({ length: GROUP_MAX + 1 }, (_, i) => item(`n${i}`, { tags: ["#kortex"], updatedAt: day(i) }));
    expect(mergeEdges(big, none)).toHaveLength(0);
    const ent = [item("a", { entities: ["Sven"] }), item("b", { entities: ["sven"] })];
    expect(mergeEdges(ent, none)[0]?.mask).toBe(KIND_BIT.entity);
  });

  it("drops edges to items outside the set", () => {
    expect(mergeEdges([item("a", { related: ["gone"] })], none)).toHaveLength(0);
  });
});

describe("buildGraph", () => {
  const items = [
    item("hub", { related: ["a", "b", "c"], updatedAt: day(5) }),
    item("a", { updatedAt: day(4) }),
    item("b", { updatedAt: day(3) }),
    item("c", { updatedAt: day(2) }),
    item("lonely", { updatedAt: day(1) }),
  ];

  it("counts degrees, orders by degree and encodes edges as index tuples", () => {
    const g = buildGraph(items, none, q(), { now: NOW });
    expect(g.nodes[0]).toMatchObject({ id: "hub", degree: 3 });
    expect(g.nodes.find((n) => n.id === "lonely")?.degree).toBe(0);
    expect(g.edges).toHaveLength(3);
    for (const [i, j, mask, w] of g.edges) {
      expect(g.nodes[i]).toBeDefined();
      expect(g.nodes[j]).toBeDefined();
      expect(mask).toBe(KIND_BIT.related);
      expect(w).toBe(100);
    }
    expect(g.stats).toMatchObject({ matching: 5, total: 5, shown: 5, edges: 3, truncated: false });
    expect(g.stats.byKind.related).toBe(3);
  });

  it("caps the node count keeping the best connected, newest first", () => {
    const g = buildGraph(items, none, q({ limit: 50 }), { now: NOW });
    expect(g.stats.truncated).toBe(false);
    const capped = buildGraph(items, none, { ...q(), limit: 2 }, { now: NOW });
    expect(capped.nodes.map((n) => n.id).sort()).toEqual(["c", "hub"]);
    expect(capped.stats).toMatchObject({ matching: 5, shown: 2, truncated: true });
    expect(capped.edges).toHaveLength(1);
  });

  it("suggests the closest pair that nothing links yet", () => {
    const g = buildGraph(items, { wiki: [], semantic: [{ a: "hub", b: "a", sim: 0.95 }, { a: "a", b: "lonely", sim: 0.81 }, { a: "b", b: "lonely", sim: 0.78 }] }, q(), { now: NOW });
    expect(g.suggestion).toMatchObject({ a: "a", b: "lonely", similarity: 0.81 });
    expect(g.stats.semantic).toBe("ok");
  });

  it("reports an empty vault and a disabled semantic layer", () => {
    const g = buildGraph([], none, q({ semantic: false }), { now: NOW });
    expect(g).toMatchObject({ nodes: [], edges: [], suggestion: null });
    expect(g.stats).toMatchObject({ total: 0, shown: 0, semantic: "off" });
  });
});

describe("layout", () => {
  const ring = (n: number) => {
    const items = Array.from({ length: n }, (_, i) => item(`n${i}`, { related: [`n${(i + 1) % n}`], tags: i % 2 ? ["#kortex"] : ["#fitness/hyrox"] }));
    return buildGraph(items, none, q({ limit: 5000 }), { now: NOW });
  };

  it("is deterministic and finite", () => {
    const a = ring(60);
    const b = ring(60);
    layoutGraph(a, { length: 60 });
    layoutGraph(b, { length: 60 });
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
    for (const n of a.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
  });

  it("keeps nodes apart", () => {
    const g = ring(40);
    layoutGraph(g, { length: 60 });
    let min = Infinity;
    for (let i = 0; i < g.nodes.length; i++)
      for (let j = i + 1; j < g.nodes.length; j++) min = Math.min(min, Math.hypot(g.nodes[i]!.x - g.nodes[j]!.x, g.nodes[i]!.y - g.nodes[j]!.y));
    expect(min).toBeGreaterThan(8);
  });

  it("handles 5,000 nodes in time", () => {
    const items = Array.from({ length: 5000 }, (_, i) => item(`n${i}`, { related: [`n${(i * 7 + 1) % 5000}`, `n${(i * 13 + 5) % 5000}`], tags: [`#t${i % 120}`] }));
    const g = buildGraph(items, none, q({ limit: 5000 }), { now: NOW });
    const t0 = performance.now();
    layoutGraph(g);
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(g.nodes).toHaveLength(5000);
    expect(g.nodes.every((n) => Number.isFinite(n.x))).toBe(true);
  }, 20_000);

  it("handles empty and single-node graphs", () => {
    const g = buildGraph([item("only")], none, q(), { now: NOW });
    layoutGraph(g);
    expect(g.nodes[0]).toMatchObject({ x: 0, y: 0 });
    layoutGraph({ nodes: [], edges: [] });
  });
});

describe("cache", () => {
  it("expires entries and evicts the least recently used", () => {
    let now = 0;
    const c = createTtlCache<number>(2, 100, () => now);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    c.set("c", 3); // evicts b (a was just used)
    expect(c.get("b")).toBeUndefined();
    now = 150;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(1);
  });

  it("fingerprints count and newest change", () => {
    expect(fingerprint(3, "2026-10-23T10:00:00Z")).not.toBe(fingerprint(4, "2026-10-23T10:00:00Z"));
    expect(fingerprint(null, null)).toBe("0:-");
  });
});
