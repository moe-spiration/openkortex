import { msg } from "../i18n";
import { accentFillFor, alpha, mix, mixOklch, oklchToHex, solidFor } from "./color";

/*
 * Typed React Native theme, Tactile Craft v2 (2026-10-29). Values are ported from
 * design/reference/ds/kortex/tokens.json (version 2) = packages/ui/src/styles/tokens.css: five luminance steps,
 * the edge rule (light upper edge = floats, dark upper edge = recessed) and one user accent from which every
 * accent colour derives (oklch mixes in ./color, like the web). No web CSS is imported. The parity test
 * (test/token-parity.test.ts) keeps these values in step with the web, the clipper and the desktop app.
 *
 * Glass: React Native on Android has no backdrop blur. Floating surfaces use glassStrong as a fill with the
 * edgeFloat ring (top-lit hairline); nothing here forces a blur.
 */

export type ThemeName = "dark" | "light";
/** Device look: "ruhe" (calm, the default since 0.6.7) or "vivid" (Tactile Craft v2, the former classic). Web: `<html data-look>`. */
export type Look = "ruhe" | "vivid";
export const LOOKS: readonly Look[] = ["ruhe", "vivid"];
export type TagTone = "ai" | "auto" | "health" | "food" | "finance" | "strategy";

export interface TagColors {
  fg: string;
  bg: string;
  border: string;
  dot: string;
}

export interface Theme {
  name: ThemeName;
  /** The device look; screens branch on it only where the Ruhe layout differs (tab bar, capture sheet, Bibliothek). */
  look: Look;

  /* ---- Tactile Craft v2 (design/reference/ds/kortex/tokens.json version 2, packages/ui/src/styles/tokens.css) ---- */
  /** Five luminance steps: 0 frame, 1 canvas/inputs/tracks, 2 card/row/active segment, 3 hover/raised, 4 active/track. */
  lum0: string;
  lum1: string;
  lum2: string;
  lum3: string;
  lum4: string;
  /** Glass fills. React Native has no backdrop blur on Android: use them as opaque-looking fills plus a hairline. */
  glass: string;
  glassStrong: string;
  /** Text steps; t4 only for decoration (never for readable text). */
  t1: string;
  t2: string;
  t3: string;
  t4: string;
  /** Navigation text only (inactive tab label). Ruhe `ts`; vivid falls back to t3. */
  ts: string;
  /** Edges: 1px hairlines, top-lit specular (floats), dark upper edge (recessed). */
  hair: string;
  hairStrong: string;
  specTop: string;
  specBottom: string;
  insetTop: string;
  /** Edge recipes as RN `boxShadow` strings (same recipe as --edge-* on the web). */
  edgeSurface: string;
  edgeRaised: string;
  edgeInset: string;
  edgeFloat: string;
  /** Accent layer: raw accent and its derivations (color-mix in oklch, like the web). */
  accent: string;
  accentInk: string;
  accentSoft: string;
  accentLine: string;
  accentFill: string;
  onAccent: string;
  ok: string;
  warn: string;
  crit: string;
  info: string;

  /* ---- Legacy names (screens use them), mapped onto the steps above like the aliases in tokens.css ---- */
  bgAppShell: string;
  bgMainWindow: string;
  bgSurfaceFlat: string;
  bgSurfaceMuted: string;
  bgFloatingGlass: string;
  bgHover: string;
  bgScrim: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderSubtle: string;
  borderFocus: string;
  accentAi: string;
  accentAiSolid: string;
  accentAiSoft: string;
  onAccentAi: string;
  accentCheckin: string;
  onAccentCheckin: string;
  statusSynced: string;
  statusProcessing: string;
  statusUrgent: string;
  statusUrgentText: string;
  tags: Record<TagTone, TagColors>;
  /** Accent used by the user-selected colour (preset key or #RRGGBB). */
  accentKey: string;
  /** Floating surfaces (tab bar, sheets, toasts): CSS box-shadow string (= edgeFloat). */
  shadowFloating: string;
}

/**
 * V2-11F: three radii. control 8 (buttons, inputs, segments), row 12 (list rows, menus, toasts),
 * card 16 (cards, tiles, sheets, floating bars). Pills (9999) only for chips. lg/xl/2xl are the
 * CSS token names of the same values.
 */
export const RADIUS = { control: 8, row: 12, card: 16, lg: 8, xl: 12, "2xl": 16, pill: 9999 } as const;

/**
 * Typography v2 scale (mirrors --type-* in packages/ui/src/styles/tokens.css).
 * size/lh in px, ls in em, weight 400|500|600. Geist everywhere; mono only for technical text.
 */
export const TYPE = {
  /** Tactile Craft v2 scale (2026-11-01): display 32/300, H1 24/500, H2/H3 15/500, body 14 on mobile, meta 12, micro 11 uppercase. */
  display: { size: 32, lh: 37, weight: 300, ls: -0.02 },
  h1: { size: 24, lh: 28, weight: 500, ls: -0.015 },
  h2: { size: 15, lh: 22, weight: 500, ls: -0.01 },
  h3: { size: 15, lh: 22, weight: 500, ls: -0.01 },
  body: { size: 14, lh: 21, weight: 400, ls: 0 },
  meta: { size: 12, lh: 18, weight: 400, ls: 0 },
  /** Group heads: 11 px uppercase, +0.06em. */
  micro: { size: 11, lh: 16, weight: 500, ls: 0.06 },
  /** Reading text of the editor and chat answers: 15/1.7. */
  read: { size: 15, lh: 25.5, weight: 400, ls: 0 },
  /** The mobile Home greeting, same step as display. */
  greeting: { size: 32, lh: 37, weight: 300, ls: -0.02 },
} as const;
export type TypeStep = keyof typeof TYPE;

export const FONT = {
  sans300: "Geist_300Light",
  sans400: "Geist_400Regular",
  sans500: "Geist_500Medium",
  sans600: "Geist_600SemiBold",
  /** Ruhe page titles (30/700). Loaded at runtime with useFonts (app/_layout.tsx), no config plugin. */
  sans700: "Geist_700Bold",
  /** Typography v2: no serif. Alias of sans600 so legacy `display` text renders in Geist. */
  display: "Geist_300Light",
  mono400: "JetBrainsMono_400Regular",
  mono500: "JetBrainsMono_500Medium",
} as const;

/**
 * Accent swatches of the settings screen, in the order of the web (apps/web/src/lib/shell/accent.ts ACCENT_SWATCHES):
 * Lila, Grün, Orange first, then the older presets. Grün and Orange are stored as hex values (key = hex), which
 * every platform understands; `solid` is the legacy darker shade (still returned by `accentPair`).
 */
export const ACCENTS = [
  { key: "violet", label: msg("Purple"), accent: "#8B5CF6", solid: "#6D28D9" },
  { key: "#10B981", label: msg("Green"), accent: "#10B981", solid: solidFor("#10B981") },
  { key: "#F97316", label: msg("Orange"), accent: "#F97316", solid: solidFor("#F97316") },
  { key: "indigo", label: msg("Indigo"), accent: "#6366F1", solid: "#4F46E5" },
  { key: "blue", label: msg("Blue"), accent: "#3B82F6", solid: "#1D4ED8" },
  { key: "teal", label: msg("Teal"), accent: "#14B8A6", solid: "#0F766E" },
  { key: "rose", label: msg("Rose"), accent: "#F43F5E", solid: "#BE123C" },
  { key: "amber", label: msg("Amber"), accent: "#F59E0B", solid: "#B45309" },
] as const;

/** Default accent (web: --kx-accent fallback #6366F1). */
export const DEFAULT_ACCENT = "indigo";

/** Normalises a typed hex ("8b5cf6", "#8B5CF6", "#abc") to #RRGGBB, or null (web `parseHex`). */
export function parseHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) return "#" + [...s].map((c) => c + c).join("").toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return "#" + s.toUpperCase();
  return null;
}

/** True for a value the accent setting may hold: a preset key or a free #RRGGBB colour (the web stores both). */
export function isAccentValue(v: string | null | undefined): v is string {
  if (!v) return false;
  return ACCENTS.some((a) => a.key === v) || /^#[0-9a-f]{6}$/i.test(v);
}

/** Raw accent colour of a preset key or a free hex colour (falls back to the default indigo). */
export function accentHex(key: string | null | undefined): string {
  const k = (key ?? "").toLowerCase();
  const preset = ACCENTS.find((a) => a.key.toLowerCase() === k);
  if (preset) return preset.accent;
  return parseHex(key ?? "") ?? "#6366F1";
}

export function accentPair(key: string): { accent: string; solid: string } {
  const preset = ACCENTS.find((a) => a.key === key);
  if (preset) return { accent: preset.accent, solid: preset.solid };
  const hex = accentHex(key);
  return { accent: hex, solid: solidFor(hex) };
}

export interface AccentLayer {
  accent: string;
  accentInk: string;
  accentSoft: string;
  accentLine: string;
  accentFill: string;
  onAccent: string;
}

/**
 * The accent layer of tokens.css for one theme (ink: dark 66 % + white, light 76 % + black). Fill and the text on it
 * follow @kortex/ui/accent accentFill (fill 90 % + black, text at 4.5:1 or more).
 */
export function accentLayer(name: ThemeName, key: string): AccentLayer {
  const accent = accentHex(key);
  const dark = name === "dark";
  const [accentFill, onAccent] = accentFillFor(accent);
  return {
    accent,
    accentInk: dark ? mixOklch(accent, 66, "#FFFFFF") : mixOklch(accent, 76, "#000000"),
    accentSoft: alpha(accent, dark ? 0.15 : 0.1),
    accentLine: alpha(accent, dark ? 0.42 : 0.34),
    accentFill,
    onAccent,
  };
}

/**
 * Ruhe-Indigo (2026-11-27, mockup default, hue 276): the Ruhe look shows the default accent key ("indigo") in the
 * mockup's own values, one per theme, with the mockup's ink. Any other swatch or free colour stays the user's choice.
 */
export const RUHE_ACCENT_HUE = 276;
export const RUHE_ACCENT = {
  dark: { accent: [0.63, 0.155, RUHE_ACCENT_HUE], ink: [0.79, 0.1, RUHE_ACCENT_HUE] },
  light: { accent: [0.56, 0.165, RUHE_ACCENT_HUE], ink: [0.49, 0.16, RUHE_ACCENT_HUE] },
} as const;

/** Accent layer of the Ruhe look: Ruhe-Indigo for the default key, the regular layer for everything else. */
export function ruheAccentLayer(name: ThemeName, key: string): AccentLayer {
  if (key.toLowerCase() !== DEFAULT_ACCENT) return accentLayer(name, key);
  const v = RUHE_ACCENT[name];
  const accent = oklchToHex([v.accent[0], v.accent[1], v.accent[2]]);
  const [accentFill, onAccent] = accentFillFor(accent);
  const dark = name === "dark";
  return {
    accent,
    accentInk: oklchToHex([v.ink[0], v.ink[1], v.ink[2]]),
    accentSoft: alpha(accent, dark ? 0.15 : 0.1),
    accentLine: alpha(accent, dark ? 0.42 : 0.34),
    accentFill,
    onAccent,
  };
}

/*
 * Ruhe layout constants for Android (android-richtlinien.md sections 3 to 5, binding). dp = CSS px of the mockup.
 * Primitives in src/ui/ruhe read these; screens should not invent other values.
 */
export const RUHE_SPACE = {
  /** Page margin of text, titles, section heads and list rows. */
  page: 20,
  /** Page margin of surfaces: cards, segments, chip rows, week band, button rows. */
  surface: 16,
  /** Title block padding (top / bottom); eyebrow sits 2 above the title. */
  headTop: 6,
  headBottom: 10,
  /** Section head padding (top / bottom). */
  labelTop: 18,
  labelBottom: 6,
  row: 52,
  rowTall: 62,
  menuRow: 48,
  iconGap: 12,
  chipGap: 4,
  gridGap: 12,
  /** Card padding top / sides / bottom and its outer margin. */
  cardTop: 14,
  cardSide: 16,
  cardBottom: 16,
  /** Floating tab bar and context button (section 9). */
  barHeight: 58,
  barBottom: 28,
  barFab: 58,
  barGap: 10,
  /** Sheets float 8 from the edges (section 10). */
  sheetInset: 8,
} as const;

/** Radii (section 5). Pro Fläche ein Radius; nothing outside this list. */
export const RUHE_RADIUS = { r6: 6, r8: 8, r10: 10, r12: 12, r14: 14, r16: 16, sheet: 36 } as const;

export interface RuheStep {
  size: number;
  lh: number;
  weight: 400 | 500 | 600 | 700;
  /** Letter spacing in em (0 except titles). */
  ls: number;
}

/** Type steps (section 3). Max three sizes per screen outside titles. */
export const RUHE_TYPE = {
  title: { size: 30, lh: 36, weight: 700, ls: -0.03 },
  titleDetail: { size: 24, lh: 29, weight: 600, ls: -0.025 },
  titleCard: { size: 17, lh: 22, weight: 500, ls: -0.02 },
  label: { size: 13, lh: 18, weight: 500, ls: 0 },
  rowTitle: { size: 15, lh: 20, weight: 500, ls: 0 },
  rowSub: { size: 12.5, lh: 17, weight: 400, ls: 0 },
  body: { size: 15, lh: 22, weight: 400, ls: 0 },
  eyebrow: { size: 13.5, lh: 18, weight: 400, ls: 0 },
  kind: { size: 12.5, lh: 16, weight: 500, ls: 0 },
  meta: { size: 12, lh: 16, weight: 400, ls: 0 },
  micro: { size: 11, lh: 14, weight: 400, ls: 0 },
  button: { size: 15, lh: 20, weight: 500, ls: 0 },
  buttonSm: { size: 14, lh: 20, weight: 500, ls: 0 },
  chip: { size: 13.5, lh: 18, weight: 400, ls: 0 },
  tabLabel: { size: 10.5, lh: 13, weight: 400, ls: 0 },
  input: { size: 20, lh: 27, weight: 400, ls: -0.015 },
} as const satisfies Record<string, RuheStep>;
export type RuheTypeStep = keyof typeof RUHE_TYPE;

/**
 * Ruhe weights a step finer (r2, owner feedback 2026-11-27, like the web's r2-type scale): no bold below title size.
 * Text under 20 px tops out at 500 (600/700 read as 500), 20 to 27 px at 600, page titles (28 px and up) keep 700.
 * Active states show through colour, never weight. Geist ships 400/500/600/700 here (no 450/550), so this is the
 * nearest step. RText and T (Ruhe) pass every weight through it.
 */
export function ruheWeight(weight: number, size: number): 300 | 400 | 500 | 600 | 700 {
  const w = weight <= 300 ? 300 : weight <= 400 ? 400 : weight <= 500 ? 500 : weight <= 600 ? 600 : 700;
  if (size >= 28) return w;
  if (size >= 20) return w > 600 ? 600 : w;
  return w > 500 ? 500 : w;
}

/** Motion tokens (section 14, 1:1 from motion-demos.html): durations in ms and cubic-bezier control points. */
export const RUHE_MOTION = {
  d1: 120,
  d2: 180,
  d3: 260,
  d4: 420,
  eo: [0.16, 1, 0.3, 1],
  eio: [0.65, 0, 0.35, 1],
  spring: [0.34, 1.36, 0.64, 1],
} as const;

const tag = (fg: string, rgb: string, dot: string): TagColors => ({
  fg,
  bg: `rgba(${rgb}, 0.12)`,
  border: `rgba(${rgb}, 0.25)`,
  dot,
});

/** Core steps per theme, 1:1 from tokens.json version 2 (checked by test/token-parity.test.ts). */
export const TACTILE = {
  dark: {
    lum0: "#0B0B0E",
    lum1: "#121216",
    lum2: "#18181D",
    lum3: "#1F1F25",
    lum4: "#27272E",
    glass: "rgba(28, 28, 34, 0.6)",
    glassStrong: "rgba(24, 24, 30, 0.86)",
    t1: "#F4F4F6",
    t2: "#C6C6CE",
    t3: "#9898A2",
    t4: "#62626C",
    hair: "rgba(255, 255, 255, 0.06)",
    hairStrong: "rgba(255, 255, 255, 0.1)",
    specTop: "rgba(255, 255, 255, 0.085)",
    specBottom: "rgba(0, 0, 0, 0.45)",
    insetTop: "rgba(0, 0, 0, 0.55)",
    drop: "0 1px 2px 0 rgba(0, 0, 0, 0.5), 0 24px 48px -20px rgba(0, 0, 0, 0.75)",
    ok: "#34D399",
    warn: "#FBBF24",
    crit: "#F87171",
    info: "#60A5FA",
  },
  light: {
    lum0: "#E7E5DF",
    lum1: "#F8F7F3",
    lum2: "#FEFDFB",
    lum3: "#F1F0EB",
    lum4: "#E8E6E0",
    glass: "rgba(251, 250, 247, 0.66)",
    glassStrong: "rgba(252, 251, 249, 0.86)",
    t1: "#18181B",
    t2: "#4E4E56",
    /** AA (4.5:1) on lum0 in light mode. */
    t3: "#66666E",
    t4: "#A1A1A8",
    hair: "rgba(24, 24, 27, 0.075)",
    hairStrong: "rgba(24, 24, 27, 0.13)",
    specTop: "rgba(255, 255, 255, 1)",
    specBottom: "rgba(24, 24, 27, 0.06)",
    insetTop: "rgba(24, 24, 27, 0.075)",
    drop: "0 1px 2px 0 rgba(24, 24, 27, 0.05), 0 18px 40px -20px rgba(24, 24, 27, 0.3)",
    ok: "#0E8F62",
    warn: "#A86A12",
    crit: "#C9303A",
    info: "#2C6FC4",
  },
} as const;

/*
 * Ruhe look (2026-11-26, briefs "Gemeinsamer Vertrag"): the same token names with new values. An OKLCH ladder from
 * one base hue (75, a slightly warm grey), flat edges (no specular top light, no inset), hairlines 5.5 / 7.5 %, one
 * soft drop for floating glass. Values mirror packages/ui/src/styles/ruhe.css and the mockup
 * (/mnt/project-files/ui-linear-2026-11/mockup-quelle/mock.src.html, [data-theme=dark|light]).
 */
export const RUHE_HUE = 75;
const ok = (l: number, c: number, h: number = RUHE_HUE) => oklchToHex([l, c, h]);
export const RUHE = {
  dark: {
    lum0: ok(0.158, 0.003),
    lum1: ok(0.188, 0.003),
    lum2: ok(0.218, 0.004),
    lum3: ok(0.248, 0.004),
    lum4: ok(0.3, 0.005),
    glass: alpha(ok(0.21, 0.004), 0.72),
    glassStrong: alpha(ok(0.2, 0.004), 0.88),
    t1: ok(0.95, 0.003),
    t2: ok(0.8, 0.004),
    t3: ok(0.64, 0.005),
    t4: ok(0.49, 0.005),
    ts: ok(0.74, 0.004),
    hair: "rgba(255, 255, 255, 0.055)",
    hairStrong: "rgba(255, 255, 255, 0.09)",
    drop: "0 12px 40px -12px rgba(0, 0, 0, 0.6)",
    ok: ok(0.74, 0.13, 158),
    warn: ok(0.8, 0.13, 78),
    crit: ok(0.7, 0.15, 25),
    info: "#60A5FA",
  },
  light: {
    lum0: ok(0.958, 0.004),
    lum1: ok(0.993, 0.0015),
    lum2: ok(0.968, 0.003),
    lum3: ok(0.946, 0.004),
    lum4: ok(0.91, 0.005),
    glass: alpha(ok(0.99, 0.002), 0.72),
    glassStrong: alpha(ok(0.99, 0.002), 0.88),
    t1: ok(0.23, 0.004),
    t2: ok(0.41, 0.005),
    t3: ok(0.53, 0.006),
    t4: ok(0.7, 0.006),
    ts: ok(0.46, 0.006),
    hair: alpha(ok(0.25, 0.01), 0.07),
    hairStrong: alpha(ok(0.25, 0.01), 0.12),
    drop: "0 12px 40px -14px rgba(40, 30, 20, 0.22)",
    ok: ok(0.58, 0.13, 158),
    warn: ok(0.66, 0.14, 70),
    crit: ok(0.57, 0.18, 25),
    info: "#2C6FC4",
  },
} as const;

/** Glass base colours of the Ruhe recipe (android-richtlinien section 6), alpha applied by the surface. */
export const RUHE_GLASS = { dark: ok(0.23, 0.004), light: ok(0.99, 0.002) } as const;

const LEGACY = {
  dark: {
    bgScrim: "rgba(4, 4, 6, 0.62)",
    accentCheckin: "#14B8A6",
    onAccentCheckin: "#04201C",
    statusSynced: "#10B981",
    statusProcessing: "#F59E0B",
    statusUrgent: "#EF4444",
    statusUrgentText: "#FCA5A5",
    tags: {
      auto: tag("#7DD3FC", "14, 165, 233", "#0EA5E9"),
      health: tag("#6EE7B7", "16, 185, 129", "#10B981"),
      food: tag("#FCD34D", "245, 158, 11", "#F59E0B"),
      finance: tag("#FDA4AF", "244, 63, 94", "#F43F5E"),
      strategy: tag("#D8B4FE", "168, 85, 247", "#A855F7"),
    },
  },
  light: {
    bgScrim: "rgba(24, 24, 27, 0.32)",
    accentCheckin: "#0F766E",
    onAccentCheckin: "#FFFFFF",
    statusSynced: "#10B981",
    statusProcessing: "#F59E0B",
    statusUrgent: "#EF4444",
    statusUrgentText: "#B91C1C",
    tags: {
      auto: tag("#0369A1", "14, 165, 233", "#0284C7"),
      health: tag("#047857", "16, 185, 129", "#059669"),
      food: tag("#92400E", "245, 158, 11", "#D97706"),
      finance: tag("#BE123C", "244, 63, 94", "#F43F5E"),
      strategy: tag("#7E22CE", "168, 85, 247", "#A855F7"),
    },
  },
} as const;

/** Builds the theme: Tactile Craft steps, edge recipes and the accent layer, plus the legacy names onto them. */
export function createTheme(
  name: ThemeName,
  accentKey: string = DEFAULT_ACCENT,
  look: Look = "ruhe",
): Theme {
  const ruhe = look === "ruhe";
  const c = ruhe ? { ...RUHE[name], specTop: "transparent", specBottom: "transparent", insetTop: "transparent" } : TACTILE[name];
  const legacy = LEGACY[name];
  const a = ruhe ? ruheAccentLayer(name, accentKey) : accentLayer(name, accentKey);
  const dark = name === "dark";
  // Ruhe is flat: edges are hairline rings only, floating glass gets one soft drop (no top light, no inset).
  const edgeFloat = ruhe ? `0 0 0 1px ${c.hairStrong}, ${c.drop}` : `inset 0 1px 0 0 ${c.specTop}, 0 0 0 1px ${c.hairStrong}, ${c.drop}`;
  return {
    name,
    look,
    lum0: c.lum0,
    lum1: c.lum1,
    lum2: c.lum2,
    lum3: c.lum3,
    lum4: c.lum4,
    glass: c.glass,
    glassStrong: c.glassStrong,
    t1: c.t1,
    t2: c.t2,
    t3: c.t3,
    t4: c.t4,
    ts: ruhe ? RUHE[name].ts : c.t3,
    hair: c.hair,
    hairStrong: c.hairStrong,
    specTop: c.specTop,
    specBottom: c.specBottom,
    insetTop: c.insetTop,
    edgeSurface: ruhe ? `0 0 0 1px ${c.hair}` : `inset 0 1px 0 0 ${c.specTop}, 0 0 0 1px ${c.hair}`,
    edgeRaised: ruhe ? `0 0 0 1px ${c.hairStrong}` : `inset 0 1px 0 0 ${c.specTop}, 0 0 0 1px ${c.hairStrong}, 0 1px 2px 0 ${c.specBottom}`,
    edgeInset: ruhe ? `0 0 0 1px ${c.hair}` : `inset 0 1px 0 0 ${c.insetTop}, 0 0 0 1px ${c.hair}, 0 1px 0 0 ${c.specTop}`,
    edgeFloat,
    ...a,
    ok: c.ok,
    warn: c.warn,
    crit: c.crit,
    info: c.info,

    bgAppShell: c.lum0,
    bgMainWindow: c.lum1,
    bgSurfaceFlat: c.lum2,
    bgSurfaceMuted: c.lum3,
    bgFloatingGlass: c.glassStrong,
    bgHover: mix(c.lum3, 55, c.lum4),
    bgScrim: legacy.bgScrim,
    textPrimary: c.t1,
    textSecondary: c.t2,
    textMuted: c.t3,
    borderSubtle: c.hair,
    borderFocus: dark ? a.accentLine : alpha(a.accent, 0.6),
    accentAi: dark ? a.accent : a.accentInk,
    accentAiSolid: a.accentFill,
    accentAiSoft: a.accentSoft,
    onAccentAi: a.onAccent,
    accentCheckin: legacy.accentCheckin,
    onAccentCheckin: legacy.onAccentCheckin,
    statusSynced: legacy.statusSynced,
    statusProcessing: legacy.statusProcessing,
    statusUrgent: legacy.statusUrgent,
    statusUrgentText: legacy.statusUrgentText,
    tags: {
      ai: { fg: a.accentInk, bg: alpha(a.accent, 0.12), border: alpha(a.accent, 0.26), dot: a.accent },
      ...legacy.tags,
    },
    accentKey,
    shadowFloating: edgeFloat,
  };
}
