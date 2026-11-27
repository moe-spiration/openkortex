/*
 * Bewegung (Settings > Erscheinungsbild): the user's choice beats the operating system.
 *
 * Windows with "Animationseffekte" off (also Remote Desktop and "Optimale Leistung") makes WebView2 and Chrome report
 * `prefers-reduced-motion: reduce`. Up to 0.6.8 the CSS asked that media query directly, so every pictogram, icon
 * gesture and view transition stopped on such a PC although Settings showed "Voll". Now the CSS only reads attributes
 * on <html>, and this module decides them:
 *   choice "system" (nothing picked yet): the OS decides (reduce -> off, otherwise full)
 *   choice "full" | "calm" | "off": exactly that, whatever the OS says
 * Attributes: data-motion="full|reduced" ("reduced" = Aus, every animation stops; name kept for the existing CSS),
 * data-calm="on" for Reduziert (shorter, no spring, still moving).
 * Stored per device in the appearance prefs (`motion`); older devices only had local.motion (Aus) and calmMotion
 * (Reduziert), which still count as a choice.
 */

export type MotionChoice = "system" | "full" | "calm" | "off";
export type MotionMode = "full" | "calm" | "off";

export const MOTION_CHOICES: readonly MotionChoice[] = ["system", "full", "calm", "off"];
export const isMotionChoice = (v: unknown): v is MotionChoice => typeof v === "string" && (MOTION_CHOICES as readonly string[]).includes(v);

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The choice in force: the stored one, else the legacy switches (Aus, Reduziert), else "system". */
export function motionChoice(stored: unknown, legacy: { off?: boolean; calm?: boolean } = {}): MotionChoice {
  if (isMotionChoice(stored)) return stored;
  if (legacy.off) return "off";
  if (legacy.calm) return "calm";
  return "system";
}

/** What actually runs: an explicit choice wins, "system" follows the OS. */
export function resolveMotion(choice: MotionChoice, osReduce: boolean): MotionMode {
  if (choice === "system") return osReduce ? "off" : "full";
  return choice;
}

export function motionAttributes(mode: MotionMode): { motion: "full" | "reduced"; calm: boolean } {
  return { motion: mode === "off" ? "reduced" : "full", calm: mode === "calm" };
}

export function osPrefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function applyMotion(mode: MotionMode, d: HTMLElement = document.documentElement): void {
  const a = motionAttributes(mode);
  d.dataset.motion = a.motion;
  if (a.calm) d.dataset.calm = "on";
  else delete d.dataset.calm;
}

/** For JS animations (graph settling, waveform, rail): true when Bewegung resolves to "Aus". */
export function motionOff(): boolean {
  if (typeof document === "undefined") return false;
  const m = document.documentElement.dataset.motion;
  // Before the settings store ran (or outside the app) the OS decides, like "system".
  return m ? m === "reduced" : osPrefersReducedMotion();
}

/**
 * Pre-paint part (lib/shell/prefs.ts PREPAINT_SCRIPT): same rule as motionChoice + resolveMotion, inlined so the first
 * paint already moves (or not). Expects `d` (<html>) and `ap` (parsed appearance prefs) in scope.
 */
export const MOTION_PREPAINT = `var mc=ap.motion;if(["system","full","calm","off"].indexOf(mc)<0){var sl={};try{sl=(JSON.parse(localStorage.getItem("kortex.settings.v1")||"{}").local)||{};}catch(e){}mc=sl.motion===true?"off":ap.calmMotion===true?"calm":"system";}if(mc==="system")mc=window.matchMedia&&window.matchMedia(${JSON.stringify(REDUCED_MOTION_QUERY)}).matches?"off":"full";d.dataset.motion=mc==="off"?"reduced":"full";if(mc==="calm")d.dataset.calm="on";else delete d.dataset.calm;`;
