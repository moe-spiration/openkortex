import { msg, t } from "../i18n";
import { RUHE_MOTION } from "../theme/tokens";

/*
 * Bewegung (Settings > Appearance), the Android side of apps/web/src/lib/settings/motion.ts: the user's choice beats
 * the operating system. Android "Remove animations" (and battery saver on some phones) reports reduce motion; up to
 * 0.6.8 that stopped every Ruhe animation although nothing was chosen in Kortex.
 *   "system" (nothing picked): the OS decides (reduce -> off, otherwise full)
 *   "full" | "calm" | "off": exactly that, whatever the OS says
 * "calm" (Reduziert) keeps moving, a third shorter, without spring and with half the travel; "off" (Aus) stops the
 * pictograms and icon gestures and turns every move into a 120 ms fade.
 * Stored per device in `kortex.prefs` (AppState); this module only holds the current choice for useMotion().
 * Pure: no React Native import, so vitest checks it.
 */

export type MotionChoice = "system" | "full" | "calm" | "off";
export type MotionMode = "full" | "calm" | "off";

export const MOTION_CHOICES: readonly MotionChoice[] = ["system", "full", "calm", "off"];

export const isMotionChoice = (v: unknown): v is MotionChoice => typeof v === "string" && (MOTION_CHOICES as readonly string[]).includes(v);

/** What actually runs: an explicit choice wins, "system" follows the OS. */
export function resolveMotion(choice: MotionChoice, osReduce: boolean): MotionMode {
  if (choice === "system") return osReduce ? "off" : "full";
  return choice;
}

/** Reduziert: the same moves, a third shorter. */
export const CALM_FACTOR = 0.7;

/** Durations d1..d4 of a mode: full = the tokens, calm = 70 %, off = every move d1 (a short fade). */
export function motionDurations(mode: MotionMode): { d1: number; d2: number; d3: number; d4: number } {
  const { d1, d2, d3, d4 } = RUHE_MOTION;
  if (mode === "off") return { d1, d2: d1, d3: d1, d4: d1 };
  if (mode === "calm") return { d1: Math.round(d1 * CALM_FACTOR), d2: Math.round(d2 * CALM_FACTOR), d3: Math.round(d3 * CALM_FACTOR), d4: Math.round(d4 * CALM_FACTOR) };
  return { d1, d2, d3, d4 };
}

/** The next choice for a cycling settings row. */
export const nextMotionChoice = (c: MotionChoice): MotionChoice => MOTION_CHOICES[(MOTION_CHOICES.indexOf(c) + 1) % MOTION_CHOICES.length]!;

const LABEL: Record<MotionChoice, string> = { system: msg("System"), full: msg("Full"), calm: msg("Reduced"), off: msg("Off") };

/** Settings value of a choice ("System", "Full", "Reduced", "Off"). */
export const motionLabel = (c: MotionChoice): string => t(LABEL[c]);

/** Settings help line: what "System" means right now. */
export function motionHelp(c: MotionChoice, osReduce: boolean): string {
  if (c !== "system") return t("Pictograms, icon gestures and transitions; your choice beats the system");
  return osReduce ? t("Follows Android: animations are off there, so Kortex stays still") : t("Follows Android: animations are on there");
}

/* ------------------------------------------------------------------ the current choice (one per app) */

let current: MotionChoice = "system";
const listeners = new Set<() => void>();

export const getMotionChoice = (): MotionChoice => current;

export function setMotionChoice(c: MotionChoice): void {
  if (c === current) return;
  current = c;
  for (const fn of listeners) fn();
}

export function subscribeMotionChoice(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
