import { tagDomain } from "@kortex/ui";
import type { ItemType } from "@/lib/workspace-data";
import {
  EDGE_KINDS,
  KIND_BIT,
  type GraphData,
  type GraphEdge,
  type GraphEdgeKind,
  type GraphNode,
  type GraphQuery,
  type GraphSuggestion,
  type SemanticState,
} from "./types";

/*
 * Pure graph construction: filter items, merge edge sources, cap the node count, count degrees.
 * No I/O here (the loader in lib/data/graph.ts fetches rows and RPC results), so everything is
 * unit-tested with plain arrays.
 */

/** The columns of a knowledge item the graph needs (no body, no embeddings). */
export interface ItemLite {
  id: string;
  title: string;
  /** UI type (`uiType(row.type)`). */
  type: ItemType;
  /** Tag names, with or without leading #. */
  tags: string[];
  entities: string[];
  /** related_item_ids */
  related: string[];
  updatedAt: string;
}

export interface ExtraEdges {
  /** [[Wiki-Link]] pairs (source -> target). */
  wiki: [string, string][];
  semantic: { a: string; b: string; sim: number }[];
}

export interface BuildOptions {
  now?: Date;
  semantic?: SemanticState;
  /** Items in the vault, for the stats line (defaults to the number of input items). */
  total?: number;
}

/** Tags / entities shared by more than this many items say little and would create near-cliques. */
export const GROUP_MAX = 40;
/** Each item links to this many neighbours (by time) inside a shared tag / entity group. */
const GROUP_FANOUT = 2;

const WEIGHT: Record<GraphEdgeKind, number> = { related: 100, wiki: 100, semantic: 70, entity: 40, tag: 25 };

export const domainOf = (tags: string[]): ReturnType<typeof tagDomain> | null => (tags[0] ? tagDomain(tags[0]) : null);

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Items that survive the type / domain / time filters. */
export function filterItems(items: ItemLite[], q: GraphQuery, now = new Date()): ItemLite[] {
  const since = q.sinceDays ? now.getTime() - q.sinceDays * 864e5 : null;
  return items.filter((i) => {
    if (q.types && !q.types.includes(i.type)) return false;
    if (q.domains && !i.tags.some((t) => q.domains!.includes(tagDomain(t)))) return false;
    if (since !== null && Date.parse(i.updatedAt) < since) return false;
    return true;
  });
}

interface Merged {
  a: string;
  b: string;
  mask: number;
  weight: number;
}

/** Edges between the given items from every source, one entry per pair with all kinds merged. */
export function mergeEdges(items: ItemLite[], extra: ExtraEdges): Merged[] {
  const ids = new Set(items.map((i) => i.id));
  const merged = new Map<string, Merged>();
  const add = (a: string, b: string, kind: GraphEdgeKind, weight: number) => {
    if (a === b || !ids.has(a) || !ids.has(b)) return;
    const key = pairKey(a, b);
    const e = merged.get(key);
    if (e) {
      e.mask |= KIND_BIT[kind];
      e.weight = Math.max(e.weight, weight);
    } else merged.set(key, { a: a < b ? a : b, b: a < b ? b : a, mask: KIND_BIT[kind], weight });
  };

  for (const i of items) for (const r of i.related) add(i.id, r, "related", WEIGHT.related);
  for (const [s, t] of extra.wiki) add(s, t, "wiki", WEIGHT.wiki);
  for (const s of extra.semantic) add(s.a, s.b, "semantic", Math.round(40 + Math.max(0, Math.min(1, s.sim)) * 60));

  // Shared tags / entities: a small group becomes a chain by time (each item reaches its next neighbours).
  const group = (pick: (i: ItemLite) => string[], kind: GraphEdgeKind) => {
    const by = new Map<string, ItemLite[]>();
    for (const i of items) for (const k of new Set(pick(i).map((x) => x.toLowerCase().replace(/^#/, "")))) (by.get(k) ?? by.set(k, []).get(k)!).push(i);
    for (const members of by.values()) {
      if (members.length < 2 || members.length > GROUP_MAX) continue;
      members.sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : x.id < y.id ? -1 : 1));
      for (let n = 0; n < members.length; n++)
        for (let k = 1; k <= GROUP_FANOUT && n + k < members.length; k++) add(members[n]!.id, members[n + k]!.id, kind, WEIGHT[kind]);
    }
  };
  group((i) => i.entities, "entity");
  group((i) => i.tags, "tag");

  return [...merged.values()];
}

/** Graph for the filtered items, capped at `q.limit` nodes (best connected first, then newest). Positions are zero until layout. */
export function buildGraph(all: ItemLite[], extra: ExtraEdges, q: GraphQuery, opts: BuildOptions = {}): GraphData {
  const now = opts.now ?? new Date();
  const matching = filterItems(all, q, now);
  const edges0 = mergeEdges(matching, extra);

  const degree = new Map<string, number>();
  for (const e of edges0) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const ranked = [...matching].sort(
    (x, y) => (degree.get(y.id) ?? 0) - (degree.get(x.id) ?? 0) || (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0) || (x.id < y.id ? -1 : 1),
  );
  const kept = ranked.slice(0, q.limit);
  const keptIds = new Set(kept.map((i) => i.id));
  const edges1 = edges0.filter((e) => keptIds.has(e.a) && keptIds.has(e.b));

  // Final degrees within the shown subgraph.
  const deg = new Map<string, number>();
  for (const e of edges1) {
    deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
    deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
  }
  const nodes: GraphNode[] = kept
    .map((i) => ({
      id: i.id,
      label: i.title,
      type: i.type,
      domain: domainOf(i.tags),
      degree: deg.get(i.id) ?? 0,
      updated: i.updatedAt,
      x: 0,
      y: 0,
    }))
    // Stable order for the index tuples: most connected first.
    .sort((x, y) => y.degree - x.degree || (x.id < y.id ? -1 : 1));
  const index = new Map(nodes.map((n, n_) => [n.id, n_]));

  const byKind = Object.fromEntries(EDGE_KINDS.map((k) => [k, 0])) as Record<GraphEdgeKind, number>;
  const edges: GraphEdge[] = edges1.map((e) => {
    for (const k of EDGE_KINDS) if (e.mask & KIND_BIT[k]) byKind[k]++;
    return [index.get(e.a)!, index.get(e.b)!, e.mask, e.weight];
  });

  // Serendipity: the closest pair that nothing links yet.
  const linked = new Set(edges1.filter((e) => e.mask & (KIND_BIT.related | KIND_BIT.wiki)).map((e) => pairKey(e.a, e.b)));
  const titles = new Map(kept.map((i) => [i.id, i.title]));
  let suggestion: GraphSuggestion | null = null;
  for (const s of extra.semantic) {
    if (!keptIds.has(s.a) || !keptIds.has(s.b) || linked.has(pairKey(s.a, s.b))) continue;
    if (!suggestion || s.sim > suggestion.similarity)
      suggestion = { a: s.a, b: s.b, aTitle: titles.get(s.a)!, bTitle: titles.get(s.b)!, similarity: Math.round(s.sim * 100) / 100 };
  }

  return {
    nodes,
    edges,
    stats: {
      matching: matching.length,
      total: opts.total ?? all.length,
      shown: nodes.length,
      edges: edges.length,
      byKind,
      truncated: matching.length > kept.length,
      limit: q.limit,
      semantic: opts.semantic ?? (q.semantic ? (extra.semantic.length ? "ok" : "empty") : "off"),
    },
    suggestion,
  };
}
