import { EIO, EO, LIN, type Track } from "./keyframes";

/*
 * The six large pictograms of the Ruhe concept (motion-demos.html "Großflächige Piktogramme", web
 * apps/web/src/components/motion/Pictogram.tsx + packages/ui/src/styles/ruhe-motion.css), as data: the moving parts
 * with their loops in the 150 × 120 drawing grid. Pictogram.tsx draws them; pure so the tests can check every track.
 */

export type PictogramKind = "inbox" | "agent" | "sync" | "stack" | "search" | "idea";
export type PictogramSize = "sm" | "md" | "lg";

export const PICTOGRAM_KINDS: readonly PictogramKind[] = ["inbox", "agent", "sync", "stack", "search", "idea"];

/** lg 208 × 166 (a whole empty view), md 150 × 120 (a section), sm 96 × 77 (a row or card); strokes in grid units. */
export const PICTOGRAM_SIZE: Record<PictogramSize, { w: number; h: number; line: number; accent: number }> = {
  lg: { w: 208, h: 166, line: 1.25, accent: 1.45 },
  md: { w: 150, h: 120, line: 1.6, accent: 1.8 },
  sm: { w: 96, h: 77, line: 1.9, accent: 2.1 },
};

/** A moving layer: loop length, delay, tracks (translate in grid units, rotate in degrees) and the still picture. */
export interface LayerSpec {
  period: number;
  delay: number;
  /** Transform origin in grid units (CSS transform-origin). */
  origin?: [number, number];
  o?: Track;
  x?: Track;
  y?: Track;
  r?: Track;
  s?: Track;
  /** stroke-dashoffset of the layer's drawn line. */
  dash?: Track;
  /** Bewegung "Aus": the picture without animation (CSS base styles). */
  rest: { o: number; x: number; y: number; r: number; s: number; dash: number };
}

const REST = { o: 1, x: 0, y: 0, r: 0, s: 1, dash: 0 };
const tr = (at: number[], v: number[], e: number = EO): Track => ({ at, v, e });

/* 1 Inbox leer: a sheet drops into the tray, the tray gives way, a check draws. 3.6 s, eo. */
export const INBOX = {
  sheet: { period: 3600, delay: 0, y: tr([0, 0.42, 0.52, 1], [-46, 6, 0, 0]), o: tr([0, 0.18, 0.86, 1], [0, 1, 1, 0]), rest: REST },
  tray: { period: 3600, delay: 0, y: tr([0, 0.4, 0.47, 0.56, 1], [0, 0, 3, 0, 0]), rest: REST },
  check: { period: 3600, delay: 0, dash: tr([0, 0.55, 0.7, 1], [30, 30, 0, 0]), o: tr([0, 0.88, 1], [1, 1, 0]), rest: REST },
} satisfies Record<string, LayerSpec>;

/* 2 Agent arbeitet: sources orbit the spark and connect (idle: slower, no wire travel). */
const orbit = (period: number, dir: 1 | -1): LayerSpec => ({ period, delay: 0, origin: [75, 60], r: tr([0, 1], [0, 360 * dir], LIN), rest: REST });
export const AGENT = {
  orb: orbit(9000, 1),
  orb2: orbit(14000, -1),
  wire: { period: 1200, delay: 0, dash: tr([0, 1], [0, -24], LIN), rest: REST },
  spark: { period: 2400, delay: 0, origin: [75, 58], s: tr([0, 0.5, 1], [1, 0.82, 1], EIO), o: tr([0, 0.5, 1], [1, 0.7, 1], EIO), rest: REST },
} satisfies Record<string, LayerSpec>;
export const AGENT_IDLE = {
  orb: orbit(24000, 1),
  orb2: orbit(36000, -1),
  wire: { period: 1200, delay: 0, rest: { ...REST, o: 0.4 } },
  spark: { ...AGENT.spark, period: 4800 },
} satisfies Record<string, LayerSpec>;

/* 3 Vault synchron: the arrows turn, two packets travel between Markdown and database. */
export const SYNC = {
  arrows: { period: 4000, delay: 0, origin: [75, 60], r: tr([0, 1], [0, 360], EIO), rest: REST },
  packetA: { period: 2000, delay: 0, x: tr([0, 1], [0, 1], EIO), o: tr([0, 0.1, 0.9, 1], [0, 1, 1, 0], EIO), rest: { ...REST, x: 0.5 } },
  packetB: { period: 2000, delay: 1000, x: tr([0, 1], [0, 1], EIO), o: tr([0, 0.1, 0.9, 1], [0, 1, 1, 0], EIO), rest: { ...REST, x: 0.5 } },
} satisfies Record<string, LayerSpec>;
/** The packets' paths (CSS offset-path), as cubic bezier points: over the top, back along the bottom. */
export const SYNC_PATH_A = [44, 60, 60, 30, 90, 30, 106, 60];
export const SYNC_PATH_B = [106, 60, 90, 90, 60, 90, 44, 60];

/* 4 Tagesstapel erledigt: the cards fan out and settle, a check pops. 4 s, eo. */
const fan = (dir: 1 | -1): LayerSpec => ({
  period: 4000,
  delay: 0,
  origin: [75, 100],
  r: tr([0, 0.15, 0.35, 0.6, 0.8, 1], [0, 0, 12 * dir, 12 * dir, 0, 0]),
  x: tr([0, 0.15, 0.35, 0.6, 0.8, 1], [0, 0, 14 * dir, 14 * dir, 0, 0]),
  rest: REST,
});
export const STACK = {
  left: fan(-1),
  right: fan(1),
  ok: { period: 4000, delay: 0, origin: [104, 30], s: tr([0, 0.78, 0.86, 0.92, 1], [0, 0, 1.15, 1, 1]), o: tr([0, 0.78, 0.86, 1], [0, 0, 1, 1]), rest: REST },
} satisfies Record<string, LayerSpec>;

/* 5 Nichts gefunden: the lens keeps looking, the rows shimmer one after another. 3.2 s, eio. */
const row = (delay: number): LayerSpec => ({ period: 3200, delay, o: tr([0, 0.5, 1], [0.35, 1, 0.35], EIO), rest: REST });
export const SEARCH = {
  rows: [row(0), row(250), row(500), row(750)],
  lens: { period: 3200, delay: 0, x: tr([0, 0.5, 1], [-26, 26, -26], EIO), rest: REST } as LayerSpec,
};
/** The four result rows (x, y, width) of the search pictogram. */
export const SEARCH_ROWS: [number, number, number][] = [
  [34, 34, 82],
  [34, 50, 64],
  [34, 66, 74],
  [34, 82, 52],
];

/* 6 Wiederentdecken: an old entry lights up, the rays draw one after another. 3 s, eo. */
const ray = (i: number): LayerSpec => ({ period: 3000, delay: i * 80, o: tr([0, 0.2, 0.4, 0.75, 1], [0, 0, 1, 1, 0]), dash: tr([0, 0.2, 0.4, 1], [10, 10, 0, 0]), rest: REST });
export const IDEA = {
  halo: { period: 3000, delay: 0, o: tr([0, 0.25, 0.45, 0.7, 1], [0, 0, 0.35, 0.35, 0]), rest: { ...REST, o: 0.2 } } as LayerSpec,
  rays: [0, 1, 2, 3, 4].map(ray),
};
export const IDEA_RAYS = ["M75 18v-8", "M100 28l6-6", "M50 28l-6-6", "M110 52h8", "M40 52h-8"];
