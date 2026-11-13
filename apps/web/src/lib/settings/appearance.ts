
/*
 * Appearance device prefs of Tactile Craft v2 (Settings > Erscheinungsbild): frame backdrop, default density,
 * per-view density and "Transparenz reduzieren". Stored per device in localStorage (like data-motion /
 * data-heroes), no user_settings column, no migration. They reach the CSS as attributes on <html>:
 *   data-backdrop="glow|pack"   effective frame backdrop (reduced transparency falls back to glow)
 *   data-density="komfort|kompakt|dicht"   default density (containers may set their own)
 *   data-glass="solid|on"       reduced transparency, or software rendering (lib/settings/gpu.ts)
 *   --kx-fs: <factor>           Schriftgröße: every font size in the UI is calc(Npx * var(--kx-fs)) (tokens.css)
 * The pre-paint script (lib/shell/prefs.ts) applies them before hydration, so nothing flashes.
 * Theme (incl. "System") and accent stay in the shell prefs (lib/shell/prefs.ts).
 */

/** Same union as @kortex/ui DensitySwitch (kept local: this module is also read by the server-rendered pre-paint script). */
import { readGpuProbe } from "./gpu";

export type Density = "komfort" | "kompakt" | "dicht";
export const DENSITIES: readonly Density[] = ["komfort", "kompakt", "dicht"];
const isDensity = (v: unknown): v is Density => typeof v === "string" && (DENSITIES as readonly string[]).includes(v);
export type Backdrop = "glow" | "pack";

export const APPEARANCE_KEY = "kortex.appearance.v1";

/** Schriftgröße steps (factor on every font size). Per device, so Windows can run smaller than the browser. */
export const FONT_SCALES = [0.85, 0.9, 1, 1.1, 1.2] as const;
export type FontScale = (typeof FONT_SCALES)[number];
const isFontScale = (v: unknown): v is FontScale => typeof v === "number" && (FONT_SCALES as readonly number[]).includes(v);

export interface AppearancePrefs {
  /** Frame backdrop behind sidebar and titlebar. Default: the accent glow (decision 5). */
  backdrop: Backdrop;
  /** Standard-Dichte for collections. Default: kompakt (decision 3). */
  density: Density;
  /** Densities the user picked per view scope (e.g. "spaces:all", "life", "objects:person"). */
  densityByScope: Record<string, Density>;
  /** Glass becomes solid surfaces, no blur. */
  reduceTransparency: boolean;
  /** Schriftgröße for the whole app on this device. Default 1 (100 %). */
  fontScale: FontScale;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  backdrop: "glow",
  density: "kompakt",
  densityByScope: {},
  reduceTransparency: false,
  fontScale: 1,
};

const isBackdrop = (v: unknown): v is Backdrop => v === "glow" || v === "pack";

/** Sanitises whatever was stored (older versions, hand edits) into valid prefs. */
export function parseAppearance(raw: unknown): AppearancePrefs {
  const p = raw && typeof raw === "object" ? (raw as Partial<Record<keyof AppearancePrefs, unknown>>) : {};
  const scoped: Record<string, Density> = {};
  if (p.densityByScope && typeof p.densityByScope === "object") {
    for (const [k, v] of Object.entries(p.densityByScope as Record<string, unknown>)) if (k && isDensity(v)) scoped[k] = v;
  }
  return {
    backdrop: isBackdrop(p.backdrop) ? p.backdrop : DEFAULT_APPEARANCE.backdrop,
    density: isDensity(p.density) ? p.density : DEFAULT_APPEARANCE.density,
    densityByScope: scoped,
    reduceTransparency: p.reduceTransparency === true,
    fontScale: isFontScale(p.fontScale) ? p.fontScale : DEFAULT_APPEARANCE.fontScale,
  };
}

export function loadAppearance(): AppearancePrefs {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_KEY);
    return raw ? parseAppearance(JSON.parse(raw)) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(p: AppearancePrefs): void {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(p));
  } catch {
    /* private mode: the prefs last for this page only */
  }
}

/** The backdrop that is actually drawn: reduced transparency has nothing to shine through, so it keeps the glow. */
export const effectiveBackdrop = (p: Pick<AppearancePrefs, "backdrop" | "reduceTransparency">): Backdrop =>
  p.reduceTransparency ? "glow" : p.backdrop;

export interface DensityInput {
  /** Standard-Dichte (Settings). */
  global: Density;
  /** What the user picked in this view (density switch), if anything. */
  scoped?: Density;
  /** The view's own default when the user picked nothing (Life: "komfort"); beats the global default. */
  fallback?: Density;
  /** A note drawer is open next to the collection: it condenses to "dicht" (decision 3). */
  drawerOpen?: boolean;
}

/** Density rule: open drawer > the view's own choice > the view's default > Standard-Dichte. */
export function resolveDensity({ global, scoped, fallback, drawerOpen }: DensityInput): Density {
  if (drawerOpen) return "dicht";
  return scoped ?? fallback ?? global;
}

/**
 * The <html> attributes for these prefs (pure, shared by the provider and tests). `softwareRender`: the device paints
 * without GPU (lib/settings/gpu.ts), glass turns solid like "Transparenz reduzieren"; the backdrop choice stays.
 */
export function appearanceAttributes(p: AppearancePrefs, softwareRender = false): { backdrop: Backdrop; density: Density; glass: "solid" | "on" } {
  return { backdrop: effectiveBackdrop(p), density: p.density, glass: p.reduceTransparency || softwareRender ? "solid" : "on" };
}

export function applyAppearance(p: AppearancePrefs, d: HTMLElement = document.documentElement, softwareRender = readGpuProbe() === "soft"): void {
  const a = appearanceAttributes(p, softwareRender);
  d.dataset.backdrop = a.backdrop;
  d.dataset.density = a.density;
  d.dataset.glass = a.glass;
  d.style.setProperty("--kx-fs", String(p.fontScale));
}
