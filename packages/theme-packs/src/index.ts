import {
  ASSETS,
  FOCUS,
  PACK_IDS,
  type AssetRef,
  type LumTopic,
  type ModeId,
  type PackId,
  type TileTopic,
  type TopicId,
} from "./manifest.gen";

export * from "./manifest.gen";

/*
 * Theme packs: covers (tiles) and backgrounds (fullscreens) for the fixed surfaces of the app.
 * Pure data and functions, no DOM and no React. Every path comes from media/manifest.json through the
 * generated module; callers pass the base URL of their platform (web: "/theme-packs").
 */

export const DEFAULT_PACK: PackId = "calm";

/** Overlay opacity of the accent tint (spec 6). */
export const ACCENT_TINT_OPACITY: Record<ModeId, number> = { dark: 0.85, light: 0.75 };

/** Window colours the scrim fades into (spec 5.2). Callers may pass their own surface instead. */
export const SCRIM_BG: Record<ModeId, string> = { dark: "#101014", light: "#FAF9F6" };

export const PACK_LABELS: Record<PackId, string> = {
  foto: "Foto",
  origami: "Origami",
  fluid: "Fluid",
  nature: "Nature",
  air: "Air",
  energy: "Energy",
  calm: "Calm",
};

export const isPackId = (v: unknown): v is PackId =>
  typeof v === "string" && (PACK_IDS as readonly string[]).includes(v);

/** Unknown or missing values fall back to the default pack. */
export const parsePack = (v: unknown): PackId => (isPackId(v) ? v : DEFAULT_PACK);

const url = (base: string, ref: AssetRef): string => `${base.replace(/\/+$/, "")}/${ref.file}?v=${ref.sha}`;

export interface TileSources {
  /** Vector (SVG) or, for the foto pack, AVIF: what web, desktop and extension render. */
  src: string;
  /** Raster WebP (Android, and the fallback of the foto pack). */
  webp: string;
}

export function tileSources(pack: PackId, mode: ModeId, topic: TileTopic, base: string): TileSources {
  const tile = ASSETS[pack][mode][topic].tile;
  const primary = tile?.svg ?? tile?.avif;
  const raster = tile?.webp;
  if (!primary || !raster) throw new Error(`theme-packs: no tile for ${pack}/${mode}/${topic}`);
  return { src: url(base, primary), webp: url(base, raster) };
}

export interface FullSources {
  avif: string;
  webp: string;
}

export function fullSources(pack: PackId, mode: ModeId, topic: TopicId, base: string): FullSources {
  const full = ASSETS[pack][mode][topic].full;
  return { avif: url(base, full.avif), webp: url(base, full.webp) };
}

/** Greyscale image for the accent tint (home and review only). */
export function lumSources(pack: PackId, mode: ModeId, topic: LumTopic, base: string): FullSources {
  const lum = ASSETS[pack][mode][topic].lum;
  if (!lum) throw new Error(`theme-packs: no luminance image for ${pack}/${mode}/${topic}`);
  return { avif: url(base, lum.avif), webp: url(base, lum.webp) };
}

/** Horizontal focus (0..1) of a fullscreen: `object-position` for narrow viewports (spec 7). */
export const focusX = (topic: TopicId): number => FOCUS[topic].x;

/** gzip size in bytes of everything a platform loads for one pack (both modes). */
export function packBytes(pack: PackId, formats: { tile: "svg" | "webp"; full: "avif" | "webp" }): number {
  let sum = 0;
  for (const mode of Object.keys(ASSETS[pack]) as ModeId[]) {
    for (const e of Object.values(ASSETS[pack][mode])) {
      const t = e.tile;
      if (t) sum += (formats.tile === "svg" ? (t.svg ?? t.avif) : t.webp)?.gzip ?? 0;
      sum += e.full[formats.full].gzip;
      if (e.lum) sum += e.lum[formats.full].gzip;
    }
  }
  return sum;
}

/* ---------------------------------------------------------------------------------------------
 * Cover rule (spec 4): own cover, then extracted medium, then the type tile of the active pack.
 * ------------------------------------------------------------------------------------------- */

const TOPIC_FOR_TYPE: Record<string, TileTopic> = {
  // kortex.knowledge_items.item_type
  article: "articles",
  bookmark: "articles",
  email: "articles",
  video: "video",
  podcast: "video",
  social: "video",
  recipe: "recipes",
  note: "notes",
  voice: "notes",
  image: "notes",
  meeting: "meetings",
  pdf: "books",
  epub: "books",
  ai_chat: "ai",
  // view-layer kinds (NOTE_TYPES, space keys)
  book: "books",
  ai: "ai",
  videos: "video",
  recipes: "recipes",
  articles: "articles",
  notes: "notes",
  meetings: "meetings",
  books: "books",
};

/** Fallback topic of an entry type: unknown types, digests and the domain objects get `all`. */
export const coverTopicForType = (type: string | null | undefined): TileTopic =>
  (type ? TOPIC_FOR_TYPE[type] : undefined) ?? "all";

export interface CoverInput {
  /** Cover set by the user. */
  own?: string | null;
  /** Medium extracted by the clipper or the media pipeline. */
  extracted?: string | null;
  type: string | null | undefined;
  pack: PackId;
  mode: ModeId;
  base: string;
}

export interface ResolvedCover {
  src: string;
  /** Where it came from; "pack" means the type tile of the active pack. */
  source: "own" | "extracted" | "pack";
  /** Only set for `pack`. */
  topic?: TileTopic;
}

const clean = (v: string | null | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);

export function resolveCover(i: CoverInput): ResolvedCover {
  const own = clean(i.own);
  if (own) return { src: own, source: "own" };
  const extracted = clean(i.extracted);
  if (extracted) return { src: extracted, source: "extracted" };
  const topic = coverTopicForType(i.type);
  return { src: tileSources(i.pack, i.mode, topic, i.base).src, source: "pack", topic };
}
