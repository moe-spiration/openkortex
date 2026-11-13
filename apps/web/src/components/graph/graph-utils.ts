import { useEffect, useState } from "react";
import type { ItemType } from "@/lib/workspace-data";
import type { GraphNode } from "@/server/graph/types";
import { intlLocale, msg } from "@/i18n";

export interface Transform {
  tx: number;
  ty: number;
  k: number;
}

export type Tone = "ai" | "auto" | "health" | "food" | "finance" | "strategy" | "checkin";

/** Colour tone of a type: the prototype's per-type tones for content, the badge tones for the seven objects. */
const TONE: Record<ItemType, Tone> = {
  note: "ai",
  meeting: "auto",
  article: "auto",
  book: "strategy",
  video: "health",
  podcast: "health",
  ai: "ai",
  recipe: "food",
  project: "ai",
  person: "auto",
  organization: "auto",
  concept: "strategy",
  tool: "checkin",
  asset: "food",
  goal: "health",
};
export const toneOf = (type: ItemType): Tone => TONE[type] ?? "ai";

/** The seven domain object types (70_Objects): drawn as squares, every other item as a circle. */
const OBJECT_TYPES = new Set<ItemType>(["project", "person", "organization", "concept", "tool", "asset", "goal"]);

/** Node shape of a type (Tactile Craft v2 graph: circle = entry, square = object). */
export type NodeShape = "circle" | "square";
export const shapeOf = (type: ItemType): NodeShape => (OBJECT_TYPES.has(type) ? "square" : "circle");

/** Type filter choices ("All" = no filter). The labels are English sources: show them with `t(g.label)`. */
export const TYPE_GROUPS: { key: string; label: string; types: ItemType[] }[] = [
  { key: "all", label: msg("All"), types: [] },
  { key: "notes", label: msg("Notes"), types: ["note"] },
  { key: "meetings", label: msg("Meetings"), types: ["meeting"] },
  { key: "articles", label: msg("Articles & books"), types: ["article", "book"] },
  { key: "media", label: msg("Media"), types: ["video", "podcast"] },
  { key: "ai", label: msg("AI"), types: ["ai"] },
  {
    key: "objects",
    label: msg("Objects"),
    types: ["project", "person", "organization", "concept", "tool", "asset", "goal"],
  },
];

/** Radius in px of a node with `degree` connections (before zoom). */
export const nodeRadius = (degree: number): number => 2.6 + Math.min(9, Math.sqrt(degree) * 1.7);

/** Transform that fits all nodes (plus the centre anchor) into a w x h viewport. */
export function fitTransform(nodes: GraphNode[], w: number, h: number): Transform {
  if (!nodes.length || w <= 0 || h <= 0) return { tx: w / 2, ty: h / 2, k: 1 };
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const k = Math.max(0.04, Math.min(2.4, Math.min((w - 190) / bw, (h - 90) / bh)));
  // Labels run to the right of their dot, so the graph sits a little left of centre.
  return { k, tx: w / 2 - 40 - ((minX + maxX) / 2) * k, ty: h / 2 - ((minY + maxY) / 2) * k };
}

export interface CanvasPalette {
  muted: string;
  /** Monochrome node colour (Text 2). */
  node: string;
  accent: string;
  /** Accent for text and neighbours of the selection. */
  accentInk: string;
  semantic: string;
  surface: string;
  tone: Record<Tone, string>;
}

const FALLBACK: CanvasPalette = {
  muted: "#9CA3AF",
  node: "#C6C6CE",
  accent: "#6366F1",
  accentInk: "#A5B4FC",
  semantic: "#A5B4FC",
  surface: "#16161C",
  tone: {
    ai: "#6366F1",
    auto: "#0EA5E9",
    health: "#10B981",
    food: "#F59E0B",
    finance: "#F43F5E",
    strategy: "#A855F7",
    checkin: "#14B8A6",
  },
};

/** Resolves CSS variables of the current theme / accent into colours a canvas understands. */
function resolvePalette(): CanvasPalette {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const get = (v: string) => {
    probe.style.color = `var(${v})`;
    return getComputedStyle(probe).color || "";
  };
  const pick = (v: string, fb: string) => get(v) || fb;
  const palette: CanvasPalette = {
    muted: pick("--edge", FALLBACK.muted),
    node: pick("--node", FALLBACK.node),
    accent: pick("--accent", FALLBACK.accent),
    accentInk: pick("--accent-ink", FALLBACK.accentInk),
    semantic: pick("--accent-ink", FALLBACK.semantic),
    surface: pick("--bg-surface-flat", FALLBACK.surface),
    tone: {
      ai: pick("--tag-ai-dot", FALLBACK.tone.ai),
      auto: pick("--tag-auto-dot", FALLBACK.tone.auto),
      health: pick("--tag-health-dot", FALLBACK.tone.health),
      food: pick("--tag-food-dot", FALLBACK.tone.food),
      finance: pick("--tag-finance-dot", FALLBACK.tone.finance),
      strategy: pick("--tag-strategy-dot", FALLBACK.tone.strategy),
      checkin: pick("--accent-checkin", FALLBACK.tone.checkin),
    },
  };
  probe.remove();
  return palette;
}

/** Canvas colours that follow the theme and accent (re-resolved when <html> attributes change). */
export function useCanvasPalette(): CanvasPalette {
  const [palette, setPalette] = useState<CanvasPalette>(FALLBACK);
  useEffect(() => {
    const update = () => setPalette(resolvePalette());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style", "data-glass"],
    });
    return () => mo.disconnect();
  }, []);
  return palette;
}

// --- Labels (W10) ----------------------------------------------------------------------------

/** From this zoom on every node may carry a label. */
export const LABEL_ZOOM_ALL = 1.6;
/** Labels are cut to this many characters; the full title is the tooltip. */
export const LABEL_MAX_CHARS = 28;

/** Title shortened to LABEL_MAX_CHARS (ellipsis included). */
export function shortLabel(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length <= LABEL_MAX_CHARS ? t : `${t.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…`;
}

/** Hubs: more than 3 connections, or among the top 15 % by degree (at least one node). */
export function hubSet(nodes: readonly Pick<GraphNode, "degree">[]): Set<number> {
  const out = new Set<number>();
  if (!nodes.length) return out;
  const sorted = nodes.map((n) => n.degree).sort((a, b) => b - a);
  const cut = sorted[Math.max(0, Math.ceil(nodes.length * 0.15) - 1)]!;
  nodes.forEach((n, i) => {
    if (n.degree > 3 || (n.degree > 0 && n.degree >= cut)) out.add(i);
  });
  return out;
}

/**
 * Nodes that may carry a label at zoom `k`, best connected first: the hubs, and every node from
 * zoom 1.6 on. (The hovered node and its neighbours are labelled on top of this, always.)
 */
export function labelCandidates(
  nodes: readonly Pick<GraphNode, "degree">[],
  hubs: ReadonlySet<number>,
  k: number,
): number[] {
  const all = k >= LABEL_ZOOM_ALL;
  const out: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (all || hubs.has(i)) out.push(i);
  return out.sort((a, b) => nodes[b]!.degree - nodes[a]!.degree);
}

/**
 * Segment (x0, y0)–(x1, y1) clipped to the box [xmin, xmax] × [ymin, ymax] (Liang–Barsky), or
 * null when it misses the box. Keeps zoomed-in edges short (fast to raster) and keeps edges whose
 * both ends are off screen but which cross it.
 */
export function clipSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
): [number, number, number, number] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return null;
      continue;
    }
    const r = qi / pi;
    if (pi < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

// --- HUDs (Tactile Craft v2) ------------------------------------------------------------------

/**
 * Type toggles of the filter HUD. The dummy's model: every type is on, a click switches one off.
 * Stored as the set of chosen groups, where the empty set means "all" (the query's `types: null`).
 * Switching off the last visible group is ignored, so the graph never filters itself empty.
 */
export function toggleTypeGroup(chosen: ReadonlySet<string>, key: string, all: readonly string[]): Set<string> {
  const on = chosen.size ? new Set(chosen) : new Set(all);
  if (on.has(key)) {
    if (on.size === 1) return new Set(chosen);
    on.delete(key);
  } else on.add(key);
  return on.size === all.length ? new Set() : on;
}

/** Whether a group is shown under `chosen` (empty = all). */
export const groupShown = (chosen: ReadonlySet<string>, key: string) => chosen.size === 0 || chosen.has(key);

/** Nodes per type group (counters of the filter HUD). */
export function groupCounts(nodes: readonly Pick<GraphNode, "type">[], groups: readonly { key: string; types: ItemType[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of groups) out[g.key] = 0;
  for (const n of nodes) {
    const g = groups.find((x) => x.types.includes(n.type));
    if (g) out[g.key] = (out[g.key] ?? 0) + 1;
  }
  return out;
}

/** Node search of the HUD: title starts with the query first, then contains it; best connected first. */
export function searchNodes<N extends Pick<GraphNode, "label" | "degree">>(nodes: readonly N[], query: string, limit = 8): N[] {
  const q = query.trim().toLocaleLowerCase(intlLocale());
  if (!q) return [];
  const hits: { n: N; rank: number }[] = [];
  for (const n of nodes) {
    const l = n.label.toLocaleLowerCase(intlLocale());
    const at = l.indexOf(q);
    if (at < 0) continue;
    hits.push({ n, rank: at === 0 ? 0 : 1 });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || b.n.degree - a.n.degree || a.n.label.localeCompare(b.n.label, intlLocale()))
    .slice(0, limit)
    .map((h) => h.n);
}

/** Neighbours of node `i`, best connected first (inspector HUD). */
export function neighboursOf(i: number, edges: readonly (readonly [number, number, ...number[]])[], nodes: readonly Pick<GraphNode, "degree">[], limit = 5): number[] {
  const set = new Set<number>();
  for (const e of edges) {
    if (e[0] === i) set.add(e[1]);
    else if (e[1] === i) set.add(e[0]);
  }
  return [...set].sort((a, b) => (nodes[b]?.degree ?? 0) - (nodes[a]?.degree ?? 0)).slice(0, limit);
}
