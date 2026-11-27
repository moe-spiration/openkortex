import { createContext, useCallback, useState } from "react";
import type { IconName } from "../iconShapes";
import { EIO, EO, LIN, SPR, type Track } from "./keyframes";

/*
 * The ten icon gestures of the Ruhe concept (motion-demos.html "Animierte Icons", web components/motion/gestures.ts
 * and the kx-g-* keyframes in ruhe-motion.css): once, under 700 ms, never looping, when the control is tapped (a
 * phone has no hover). Icon.tsx plays them; a pressable host (RPress, RRow, RIconButton, Btn, the tab bar) hands
 * its tap count down through GestureCtx, or a caller passes `play` to the Icon. Bewegung "Aus" plays none,
 * "Reduziert" a third shorter without spring.
 */

export type GestureKey = "twinkle" | "ring" | "level" | "draw" | "starpop" | "settle" | "spin" | "lid" | "up" | "pulse";

export interface GestureSpec {
  dur: number;
  /** Transform origin in % of the icon box. */
  origin?: [number, number];
  r?: Track;
  s?: Track;
  /** Vertical scale only (the microphone's level). */
  sy?: Track;
  /** Translate in px of a 16 px icon (scaled with the size). */
  x?: Track;
  y?: Track;
  o?: Track;
  /** Share of the icon revealed from the left (the check draws itself). */
  reveal?: Track;
}

const tr = (at: number[], v: number[], e: number = EO): Track => ({ at, v, e });

export const GESTURES: Record<GestureKey, GestureSpec> = {
  twinkle: { dur: 600, origin: [50, 50], s: tr([0, 0.45, 1], [1, 0.7, 1]), r: tr([0, 0.45, 1], [0, 22, 0]) },
  ring: { dur: 700, origin: [50, 10], r: tr([0, 0.2, 0.4, 0.6, 0.8, 1], [0, 16, -12, 7, -3, 0]) },
  level: { dur: 650, origin: [50, 100], sy: tr([0, 0.3, 0.6, 1], [1, 1.14, 0.92, 1]) },
  draw: { dur: 460, reveal: tr([0, 1], [0, 1]) },
  starpop: { dur: 550, origin: [50, 50], s: tr([0, 0.4, 1], [1, 0.7, 1], SPR) },
  settle: { dur: 600, y: tr([0, 0.55, 1], [-3, 1, 0]), o: tr([0, 0.55, 1], [0.55, 1, 1]) },
  spin: { dur: 700, origin: [50, 50], r: tr([0, 1], [0, 360], EIO) },
  lid: { dur: 650, origin: [12, 30], r: tr([0, 0.4, 1], [0, -12, 0]), y: tr([0, 0.4, 1], [0, -1, 0]) },
  up: { dur: 500, y: tr([0, 0.35, 0.36, 1], [0, -4, 5, 0]), o: tr([0, 0.35, 0.36, 1], [1, 0, 0, 1], LIN) },
  pulse: { dur: 650, origin: [50, 50], s: tr([0, 0.4, 1], [1, 1.18, 1]) },
};

/** Which icons carry a gesture (the concept's ten, mapped to this app's icon names). */
export const GESTURE_OF: Partial<Record<IconName, GestureKey>> = {
  sparkles: "twinkle",
  bell: "ring",
  mic: "level",
  audioLines: "level",
  check: "draw",
  checkCircle: "draw",
  checkSquare: "draw",
  star: "starpop",
  inbox: "settle",
  sync: "spin",
  archive: "lid",
  trash: "lid",
  send: "up",
  arrowUp: "up",
  share: "pulse",
};

/** Tap count of the pressable around an icon; null = no host (the icon stays still). */
export const GestureCtx = createContext<number | null>(null);

/** A host's tap count and the function that bumps it (call it in onPress). */
export function useGesturePlay(): [number, () => void] {
  const [n, setN] = useState(0);
  const fire = useCallback(() => setN((x) => x + 1), []);
  return [n, fire];
}
