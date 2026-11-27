import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Easing as RNEasing, Platform } from "react-native";
import { Easing, ReducedMotionConfig, ReduceMotion, useReducedMotion } from "react-native-reanimated";
import { CALM_FACTOR, getMotionChoice, motionDurations, resolveMotion, subscribeMotionChoice, type MotionChoice, type MotionMode } from "../../lib/motionPref";
import { RUHE_MOTION } from "../../theme/tokens";

/*
 * One motion system for the Ruhe look (android-richtlinien section 14, motion-demos.html 1:1):
 * d1 120 (press), d2 180 (switch, sheet out), d3 260 (sheet in, toast), d4 420 (skeleton); eo is the standard
 * curve, eio for changes, spring for toast, toggle and segment. Only opacity and transform move.
 * Bewegung (Settings > Appearance, src/lib/motionPref.ts) decides: Full, Reduced (a third shorter, no spring, half
 * the travel) or Off (every move a 120 ms fade without offset, pictograms and icon gestures still). Only "System"
 * follows Android's reduce-motion switch; an explicit choice beats it.
 */

const [e1, e2, e3, e4] = RUHE_MOTION.eo;
const [i1, i2, i3, i4] = RUHE_MOTION.eio;
const [s1, s2, s3, s4] = RUHE_MOTION.spring;

/** Reanimated curves (withTiming `easing`). Safe to capture in worklets. */
export const EO = Easing.bezier(e1, e2, e3, e4);
export const EIO = Easing.bezier(i1, i2, i3, i4);
export const SPRING = Easing.bezier(s1, s2, s3, s4);

/** The same curves for React Native's Animated API. */
export const RN_EASE = { eo: RNEasing.bezier(e1, e2, e3, e4), eio: RNEasing.bezier(i1, i2, i3, i4), spring: RNEasing.bezier(s1, s2, s3, s4) } as const;

/** Native driver for RN Animated (not on the web). */
export const NATIVE = Platform.OS !== "web";

/** True when the system asks for reduced motion (Reanimated's flag plus AccessibilityInfo, live). */
export function useReduceMotion(): boolean {
  const reanimated = useReducedMotion();
  const [system, setSystem] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setSystem(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setSystem);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reanimated || system;
}

export interface Motion {
  /** What runs: full, calm (Reduziert) or off (Aus). */
  mode: MotionMode;
  /** Bewegung "Aus" (or "System" with Android's reduce motion): fades only, no loops, no gestures. */
  reduced: boolean;
  /** Bewegung "Reduziert": shorter, no spring, half the travel. */
  calm: boolean;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
  eo: typeof EO;
  eio: typeof EIO;
  spring: typeof SPRING;
  /** An offset in dp, half of it when calm, 0 when motion is off (fade only). */
  offset: (dp: number) => number;
  /** A duration, shorter when calm, d1 when motion is off. */
  dur: (ms: number) => number;
}

/** The user's Bewegung choice (live). */
export const useMotionChoice = (): MotionChoice => useSyncExternalStore(subscribeMotionChoice, getMotionChoice, getMotionChoice);

/** The central motion hook: tokens plus the Bewegung choice (which beats the system's reduce motion). */
export function useMotion(): Motion {
  const os = useReduceMotion();
  const choice = useMotionChoice();
  const mode = resolveMotion(choice, os);
  return useMemo(() => {
    const d = motionDurations(mode);
    const off = mode === "off";
    const calm = mode === "calm";
    return {
      mode,
      reduced: off,
      calm,
      ...d,
      eo: EO,
      eio: EIO,
      spring: off || calm ? EO : SPRING,
      offset: (dp: number) => (off ? 0 : calm ? dp / 2 : dp),
      dur: (ms: number) => (off ? RUHE_MOTION.d1 : calm ? Math.round(ms * CALM_FACTOR) : ms),
    };
  }, [mode]);
}

/**
 * Reanimated skips every animation when Android asks for reduced motion (ReduceMotion.System is its default). With
 * Bewegung "Voll" or "Reduziert" chosen, that must not happen: mount this once at the root.
 */
export function MotionConfig() {
  const m = useMotion();
  return <ReducedMotionConfig mode={m.reduced ? ReduceMotion.System : ReduceMotion.Never} />;
}
