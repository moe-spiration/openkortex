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
import type { ThemePref } from "./bridge/contract";

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
  if (/^[0-9a-f]{3}$/i.test(s))
    return (
      "#" +
      [...s]
        .map((c) => c + c)
        .join("")
        .toUpperCase()
    );
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
export function resolveAccent(
  param: string | null,
  storage: Pick<Storage, "getItem"> | null,
): string | null {
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

/*
 * Look of the desktop's own windows (HUD, pill, quick capture, tray, small windows): the calm "ruhe" look (default)
 * or "vivid" (the former classic look; a stored "classic" from before 0.6.7 reads as "ruhe"), <html data-look>. Stored per device in localStorage `kortex.desktop.look` like the font
 * size, `?look=ruhe` for the browser preview. The main window shows the web app, which has its own switch under
 * Einstellungen > Erscheinungsbild > Look.
 */
export type Look = "ruhe" | "vivid";
export const LOOK_KEY = "kortex.desktop.look";

export const parseLook = (v: string | null | undefined): Look => (v === "vivid" ? "vivid" : "ruhe");

/** `?look=` first, then the stored look. */
export function readLook(param: string | null, storage: Pick<Storage, "getItem"> | null): Look {
  if (param === "ruhe" || param === "vivid") return param;
  try {
    return parseLook(storage?.getItem(LOOK_KEY));
  } catch {
    return "ruhe";
  }
}

export function applyLook(root: HTMLElement, look: Look): void {
  root.dataset.look = look;
  // Ruhe steps its font weights down on Windows, where Geist renders heavier (packages/ui ruhe.css, data-os).
  if (typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)) root.dataset.os = "windows";
}

/*
 * Light or dark (Ruhe D5): the desktop's own windows follow Windows by default (prefers-color-scheme; the core sets
 * WebView2's scheme with `set_theme`) or a fixed choice from Einstellungen → Erscheinungsbild. Stored per device in
 * localStorage `kortex.desktop.theme` like look and font size, so every open window follows through the `storage`
 * event; the core keeps a copy in desktop.json for the native parts. `?theme=` (browser preview, screenshots) wins.
 */
export type { ThemePref };
export const THEME_KEY = "kortex.desktop.theme";

export const parseTheme = (v: string | null | undefined): ThemePref => (v === "light" || v === "dark" ? v : "system");

/** `?theme=light|dark` first, then the stored choice ("system" when nothing or something else is stored). */
export function readTheme(param: string | null, storage: Pick<Storage, "getItem"> | null): ThemePref {
  if (param === "light" || param === "dark") return param;
  try {
    return parseTheme(storage?.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

/** The colours a window shows for `pref`; "system" asks Windows (prefers-color-scheme). */
export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

/** Sets <html data-theme> (light / dark); the tokens of @kortex/ui switch on it. */
export function applyTheme(root: HTMLElement, theme: "light" | "dark"): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/** Stored accent (Einstellungen → Erscheinungsbild → Akzent): preset id or hex, null = default. */
export const ACCENT_CHOICES = ["indigo", "violet", "blue", "teal", "rose", "amber"] as const;
