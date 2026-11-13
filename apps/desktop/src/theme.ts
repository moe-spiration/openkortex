/*
 * Accent of the desktop's own windows (Tactile Craft v2): HUD, pill, quick capture, tray and the small native
 * windows. Every accent colour derives in CSS from --kx-accent (packages/ui/src/styles/tokens.css); the accent fill
 * and the text on it (--kx-accent-fill, --kx-on-accent, WCAG AA) come from @kortex/ui/accent, shared with the web.
 *
 * Source of the value, first wins: `?accent=` (browser preview, screenshots), then localStorage
 * `kortex.desktop.accent` (shared by all local windows, same origin). Nothing set = the token default (#6366F1).
 * The web app in the main window keeps its own accent (user_settings.accent); syncing both is open (see docs).
 */

import { accentFill } from "@kortex/ui/accent";

/** Preset ids of the web (apps/web/src/lib/shell/accent.ts ACCENTS). Grün/Orange are stored as hex values. */
export const ACCENT_PRESETS: Record<string, string> = {
  indigo: "#6366F1",
  teal: "#14B8A6",
  violet: "#8B5CF6",
  blue: "#3B82F6",
  rose: "#F43F5E",
  amber: "#F59E0B",
};

export const ACCENT_STORAGE_KEY = "kortex.desktop.accent";

/** Preset id or #rgb / #rrggbb (with or without #) → #RRGGBB, else null. */
export function accentHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const preset = ACCENT_PRESETS[v.toLowerCase()];
  if (preset) return preset;
  const s = v.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) return "#" + [...s].map((c) => c + c).join("").toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return "#" + s.toUpperCase();
  return null;
}

export { onAccentColor } from "@kortex/ui/accent";

/** Sets --kx-accent, --kx-accent-fill and --kx-on-accent on `root`; an invalid value clears them (token default). Returns the hex. */
export function applyAccent(root: HTMLElement, value: string | null | undefined): string | null {
  const hex = accentHex(value);
  if (!hex) {
    root.style.removeProperty("--kx-accent");
    root.style.removeProperty("--kx-accent-fill");
    root.style.removeProperty("--kx-on-accent");
    return null;
  }
  root.style.setProperty("--kx-accent", hex);
  const [fill, on] = accentFill(hex);
  root.style.setProperty("--kx-accent-fill", fill);
  root.style.setProperty("--kx-on-accent", on);
  return hex;
}

/** The accent to use: `?accent=` first, then the stored desktop accent. */
export function resolveAccent(param: string | null, storage: Pick<Storage, "getItem"> | null): string | null {
  if (accentHex(param)) return param;
  try {
    const stored = storage?.getItem(ACCENT_STORAGE_KEY) ?? null;
    return accentHex(stored) ? stored : null;
  } catch {
    return null;
  }
}

/*
 * Schriftgröße of the desktop's own windows (Einstellungen, Audio-Setup, Meeting-Center, HUD, Quick Capture, Tray).
 * Every font size in @kortex/ui is calc(Npx * var(--kx-fs, 1)); the factor is stored per device in localStorage
 * `kortex.desktop.fontScale` (same origin for all local windows, so a `storage` event updates the open ones).
 * The main window shows the web app, which has the same setting under Einstellungen → Erscheinungsbild.
 */
export const FONT_SCALES = [0.85, 0.9, 1, 1.1, 1.2] as const;
export const FONT_SCALE_KEY = "kortex.desktop.fontScale";

/** Stored value → one of FONT_SCALES (anything else = 1). */
export function parseFontScale(v: string | null | undefined): number {
  const n = Number(v);
  return (FONT_SCALES as readonly number[]).includes(n) ? n : 1;
}

export function readFontScale(storage: Pick<Storage, "getItem"> | null): number {
  try {
    return parseFontScale(storage?.getItem(FONT_SCALE_KEY));
  } catch {
    return 1;
  }
}

export function applyFontScale(root: HTMLElement, scale: number): void {
  root.style.setProperty("--kx-fs", String(parseFontScale(String(scale))));
}
