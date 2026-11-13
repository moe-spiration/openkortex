/**
 * Live level store (fx3): `audio:levels` arrives ~30 times a second. It does not go through React
 * state (that re-rendered every window's whole tree per event); the meters subscribe here and write
 * the DOM themselves, at most once per animation frame.
 */

export interface Levels {
  /** dBFS of channel 0 (microphone) and 1 (system), floor -60. */
  a: number;
  b: number;
  /** false = the microphone delivered only digital silence for 3 s. */
  mic: boolean;
}

type Sub = (l: Levels) => void;

export const SILENT: Levels = { a: -60, b: -60, mic: true };

export function createLevelStore() {
  let cur = SILENT;
  let pending = false;
  const subs = new Set<Sub>();
  const flush = () => {
    pending = false;
    subs.forEach((f) => f(cur));
  };
  // rAF pauses in hidden windows (no work for a hidden pill); jsdom has no rAF.
  const schedule = (cb: () => void) =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(cb, 16);
  return {
    get: () => cur,
    set(l: Levels) {
      cur = l;
      if (pending) return;
      pending = true;
      schedule(flush);
    },
    subscribe(f: Sub) {
      subs.add(f);
      f(cur);
      return () => {
        subs.delete(f);
      };
    },
  };
}

export const levelStore = createLevelStore();
