import type { TagDomain } from "@kortex/ui";
import type { ItemType } from "@/lib/workspace-data";

/*
 * Knowledge graph payload. Nodes are knowledge items and domain objects; edges come from
 * related_item_ids ("related"), [[wiki-links]] in the body ("wiki"), chunk-embedding similarity
 * ("semantic") and shared tags / entities. Edges travel as index tuples into `nodes` to keep the
 * response small (a 5,000 node graph is well below a megabyte of JSON).
 */

export const EDGE_KINDS = ["related", "wiki", "semantic", "entity", "tag"] as const;
export type GraphEdgeKind = (typeof EDGE_KINDS)[number];
/** Bit of a kind in the `mask` of an edge tuple. */
export const KIND_BIT: Record<GraphEdgeKind, number> = { related: 1, wiki: 2, semantic: 4, entity: 8, tag: 16 };

export interface GraphNode {
  id: string;
  label: string;
  type: ItemType;
  /** Tag domain of the item's first tag, null without tags. */
  domain: TagDomain | null;
  /** Number of distinct neighbours. */
  degree: number;
  /** ISO timestamp of the last change. */
  updated: string;
  x: number;
  y: number;
}

/** [from index, to index, kind bit mask, weight 0..100]. */
export type GraphEdge = [number, number, number, number];

export type SemanticState = "ok" | "empty" | "off" | "error";

export interface GraphSuggestion {
  a: string;
  b: string;
  aTitle: string;
  bTitle: string;
  /** Cosine similarity of the two items, 0..1. */
  similarity: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    /** Items matching the filters before the node cap. */
    matching: number;
    /** Items in the vault (not archived). */
    total: number;
    shown: number;
    edges: number;
    byKind: Record<GraphEdgeKind, number>;
    /** More items matched than `limit`: the best connected / newest are shown. */
    truncated: boolean;
    limit: number;
    semantic: SemanticState;
  };
  /** Best semantic pair that is not linked yet (Serendipity card). */
  suggestion: GraphSuggestion | null;
}

export interface GraphQuery {
  /** UI types to show; null = all. */
  types: ItemType[] | null;
  /** Tag domains (themes) to show, any of them; null = all (W10: multiple choice). */
  domains: TagDomain[] | null;
  /** Only items changed in the last N days; null = all time. */
  sinceDays: number | null;
  semantic: boolean;
  limit: number;
}

export const GRAPH_LIMIT_DEFAULT = 1500;
export const GRAPH_LIMIT_MAX = 5000;

export const DEFAULT_GRAPH_QUERY: GraphQuery = { types: null, domains: null, sinceDays: null, semantic: true, limit: GRAPH_LIMIT_DEFAULT };
