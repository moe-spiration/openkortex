/*
 * Keyframe tracks for the Ruhe motion on the UI thread (pictograms, icon gestures, task check), the Android side of
 * the CSS @keyframes in packages/ui/src/styles/ruhe-motion.css. A track holds stops (`at`, 0..1 of the loop or the
 * gesture) and values; every segment between two stops runs on one curve, like a CSS animation-timing-function.
 * All functions are worklets without default parameters (test/worklets-ui-thread.test.ts) and pure, so vitest runs
 * them as plain JS (test/ruhe-motion.test.ts).
 */

/** Curves: linear, eo, eio, spring (RUHE_MOTION in theme/tokens.ts, checked by the test). */
export const LIN = 0;
export const EO = 1;
export const EIO = 2;
export const SPR = 3;

const CURVES: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1, 1],
  [0.16, 1, 0.3, 1],
  [0.65, 0, 0.35, 1],
  [0.34, 1.36, 0.64, 1],
];

export interface Track {
  /** Stops, ascending from 0 to 1. */
  at: number[];
  /** One value per stop. */
  v: number[];
  /** Curve of every segment (LIN, EO, EIO, SPR). */
  e: number;
}

/** y of a CSS cubic-bezier(x1, y1, x2, y2) at x (bisection on t, 1/4096 precise). */
export function bezierAt(x1: number, y1: number, x2: number, y2: number, x: number): number {
  "worklet";
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 14; i++) {
    t = (lo + hi) / 2;
    const u = 1 - t;
    const bx = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    if (bx < x) lo = t;
    else hi = t;
  }
  t = (lo + hi) / 2;
  const u = 1 - t;
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
}

/** A curve (LIN, EO, EIO, SPR) at s in 0..1. */
export function curveAt(e: number, s: number): number {
  "worklet";
  if (e === LIN) return s;
  const c = CURVES[e] ?? CURVES[1]!;
  return bezierAt(c[0], c[1], c[2], c[3], s);
}

/** The value of a track at p (0..1); `calm` (Bewegung "Reduziert") runs spring segments on eo. */
export function trackAt(tr: Track, p: number, calm: boolean): number {
  "worklet";
  const at = tr.at;
  const v = tr.v;
  if (p <= at[0]!) return v[0]!;
  const e = calm && tr.e === SPR ? EO : tr.e;
  for (let i = 1; i < at.length; i++) {
    const a = at[i]!;
    if (p <= a) {
      const b = at[i - 1]!;
      const s = a > b ? (p - b) / (a - b) : 1;
      return v[i - 1]! + (v[i]! - v[i - 1]!) * curveAt(e, s);
    }
  }
  return v[v.length - 1]!;
}

/** Position 0..1 inside a loop of `period` ms at time `ms`, shifted by `delay` ms (CSS animation-delay). */
export function loopAt(ms: number, period: number, delay: number): number {
  "worklet";
  const x = (((ms - delay) % period) + period) % period;
  return x / period;
}

/** A point on the cubic bezier (x0 y0 c1 c2 x1 y1, 8 numbers) at t: the sync packets' path (CSS offset-path). */
export function cubicPoint(q: number[], t: number): { x: number; y: number } {
  "worklet";
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * q[0]! + b * q[2]! + c * q[4]! + d * q[6]!, y: a * q[1]! + b * q[3]! + c * q[5]! + d * q[7]! };
}
