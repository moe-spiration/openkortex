/* Accent colours (design/reference/WebApp.dc.html, ACCENTS + accentPair). */

/*
 * accentPair (preset id or #rrggbb → [accent, solid]), accentFill (→ [--accent-fill, --on-accent], WCAG AA for any
 * accent) and onAccentColor live in @kortex/ui/accent, shared with the desktop app; re-exported here so web code
 * keeps one import path. Mobile keeps a React Native copy, pinned by apps/mobile/test/token-parity.test.ts.
 */
import { t } from "@/i18n";
import { accentPair } from "@kortex/ui/accent";

export { accentFill, accentPair, contrastRatio, onAccentColor } from "@kortex/ui/accent";

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
  solid: string;
}

export const ACCENTS: AccentPreset[] = [
  { id: "indigo", get label() { return t("Indigo"); }, hex: "#6366F1", solid: "#4F46E5" },
  { id: "teal", get label() { return t("Teal"); }, hex: "#14B8A6", solid: "#0F766E" },
  { id: "violet", get label() { return t("Violet"); }, hex: "#8B5CF6", solid: "#6D28D9" },
  { id: "blue", get label() { return t("Blue"); }, hex: "#3B82F6", solid: "#1D4ED8" },
  { id: "rose", get label() { return t("Rose"); }, hex: "#F43F5E", solid: "#BE123C" },
  { id: "amber", get label() { return t("Amber"); }, hex: "#F59E0B", solid: "#B45309" },
];

/** The raw accent colour of a preset id or custom hex. */
export const accentHex = (a: string | null | undefined): string => accentPair(a)[0];

/**
 * Swatches of Settings > Erscheinungsbild (dummy: Lila, Grün, Orange plus the older presets). Grün and Orange are
 * stored as hex values, which every platform understands (no new preset ids for the accent column).
 */
export const ACCENT_SWATCHES: { value: string; label: string; hex: string }[] = [
  { value: "violet", get label() { return t("Purple"); }, hex: "#8B5CF6" },
  { value: "#10B981", get label() { return t("Green"); }, hex: "#10B981" },
  { value: "#F97316", get label() { return t("Orange"); }, hex: "#F97316" },
  { value: "indigo", get label() { return t("Indigo"); }, hex: "#6366F1" },
  { value: "blue", get label() { return t("Blue"); }, hex: "#3B82F6" },
  { value: "teal", get label() { return t("Teal"); }, hex: "#14B8A6" },
  { value: "rose", get label() { return t("Rose"); }, hex: "#F43F5E" },
  { value: "amber", get label() { return t("Amber"); }, hex: "#F59E0B" },
];

/** Normalises a typed hex ("8b5cf6", "#8B5CF6", "#abc") to #RRGGBB, or null. */
export function parseHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) return "#" + s.split("").map((c) => c + c).join("").toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return "#" + s.toUpperCase();
  return null;
}
