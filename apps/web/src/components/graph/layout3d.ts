import type { GraphData } from "@/server/graph/types";

/*
 * Pure helpers of the 3D graph (no three.js here, so tests and the worker can import them):
 * start positions, the flat 2D layout, adjacency and the label choice.
 */

/**
 * Ticks of one full layout run (warmup + visible cooldown). Big graphs get fewer: they start from
 * the server's finished 2D layout and only need to unfold into depth, and a tick of the many-body
 * force costs ~20 ms per 1000 nodes on a laptop.
 */
export const layoutTicks = (n: number) => (n <= 800 ? 300 : n <= 2000 ? 200 : 130);
/** Wall-clock budget of one run; the simulation cools down early when it runs out. */
export const LAYOUT_BUDGET_MS = 9000;

export interface LayoutRequest {
  token: number;
  n: number;
  /** Start positions, xyz per node. */
  init: Float32Array;
  /** Edge endpoints, two indices per edge. */
  edges: Uint32Array;
  /** Edge weights 0..100, one per edge. */
  weights: Float32Array;
  degree: Uint16Array;
  /** Most nodes already have a position (filter change): skip the warmup, start cooler. */
  warm: boolean;
}

export interface LayoutReply {
  token: number;
  positions: Float32Array;
  done: boolean;
}

/** Deterministic 0..1 hash of a string (stable z offsets for the same item). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** World radius the graph of n nodes roughly fills (used to scale the server's 2D layout). */
export const worldRadius = (n: number) => 40 + 11 * Math.sqrt(Math.max(1, n));

/**
 * The server's 2D layout centred and scaled to the 3D world (z = 0): the flat mode, and the start
 * of the 3D layout for nodes without a known position.
 */
export function flatPositions(nodes: GraphData["nodes"]): Float32Array {
  const n = nodes.length;
  const out = new Float32Array(n * 3);
  if (!n) return out;
  let cx = 0;
  let cy = 0;
  for (const p of nodes) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let rms = 0;
  for (const p of nodes) rms += (p.x - cx) ** 2 + (p.y - cy) ** 2;
  rms = Math.sqrt(rms / n) || 1;
  const s = (worldRadius(n) * 0.75) / rms;
  nodes.forEach((p, i) => {
    out[i * 3] = (p.x - cx) * s;
    out[i * 3 + 1] = -(p.y - cy) * s; // screen y runs down, world y up
    out[i * 3 + 2] = 0;
  });
  return out;
}

/**
 * Start positions for the 3D layout: a node keeps its last position (by id) when it has one,
 * otherwise it starts on the flat layout lifted by a stable z offset, so the sphere unfolds from
 * the familiar picture.
 */
export function initPositions(nodes: GraphData["nodes"], known: ReadonlyMap<string, readonly [number, number, number]>): { init: Float32Array; reused: number } {
  const flat = flatPositions(nodes);
  const R = worldRadius(nodes.length);
  let reused = 0;
  nodes.forEach((p, i) => {
    const k = known.get(p.id);
    if (k) {
      flat[i * 3] = k[0];
      flat[i * 3 + 1] = k[1];
      flat[i * 3 + 2] = k[2];
      reused++;
    } else flat[i * 3 + 2] = (hash01(p.id) - 0.5) * R;
  });
  return { init: flat, reused };
}

/** Neighbour lists of every node. */
export function adjacency(n: number, edges: GraphData["edges"]): number[][] {
  const a: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    if (e[0] >= n || e[1] >= n || e[0] === e[1]) continue;
    a[e[0]]!.push(e[1]);
    a[e[1]]!.push(e[0]);
  }
  return a;
}

/** Layout request of a graph. */
export function layoutRequest(n: number, graphEdges: GraphData["edges"], init: Float32Array, warm: boolean, token: number): LayoutRequest {
  const valid = graphEdges.filter((e) => e[0] < n && e[1] < n && e[0] !== e[1]);
  const edges = new Uint32Array(valid.length * 2);
  const weights = new Float32Array(valid.length);
  valid.forEach((e, k) => {
    edges[k * 2] = e[0];
    edges[k * 2 + 1] = e[1];
    weights[k] = e[3];
  });
  const degree = new Uint16Array(n);
  for (const e of valid) {
    degree[e[0]] = Math.min(65535, degree[e[0]]! + 1);
    degree[e[1]] = Math.min(65535, degree[e[1]]! + 1);
  }
  return { token, n, init, edges, weights, degree, warm };
}

export interface LabelCandidate {
  i: number;
  /** Screen position of the node centre (px). */
  x: number;
  y: number;
  /** Node radius on screen (px). */
  r: number;
  /** Higher first. */
  priority: number;
  width: number;
}

export interface PlacedLabel {
  i: number;
  x: number;
  y: number;
}

/**
 * Greedy label placement: candidates by priority, a label (to the right of its node) is placed
 * when it fits on screen and does not overlap one already placed.
 */
export function placeLabels(cands: LabelCandidate[], w: number, h: number, max: number, height = 20): PlacedLabel[] {
  const sorted = [...cands].sort((a, b) => b.priority - a.priority);
  const boxes: [number, number, number, number][] = [];
  const out: PlacedLabel[] = [];
  for (const c of sorted) {
    if (out.length >= max) break;
    const x0 = c.x + c.r + 4;
    const y0 = c.y - height / 2;
    const x1 = x0 + c.width;
    const y1 = y0 + height;
    if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) continue;
    if (boxes.some((b) => x0 < b[2] + 4 && x1 + 4 > b[0] && y0 < b[3] + 2 && y1 + 2 > b[1])) continue;
    boxes.push([x0, y0, x1, y1]);
    out.push({ i: c.i, x: x0, y: y0 });
  }
  return out;
}

/** Estimated label width in px (12 px UI font, ~6.6 px per character, plus padding). */
export const labelWidth = (text: string) => 12 + text.length * 6.6;
