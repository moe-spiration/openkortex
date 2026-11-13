/*
 * Push-to-talk drop targets. While the orb is held, the real buttons of the voice card ("Verwerfen" and
 * "In Inbox") are the targets: sliding onto one highlights it, releasing there runs it, releasing anywhere
 * else saves. Rects are window coordinates from measureInWindow, packed flat so a shared value can carry them
 * to the UI thread: [discardX, discardY, discardW, discardH, saveX, saveY, saveW, saveH]. A width of 0 means
 * "not measured yet" and never hits.
 */

export const PTT_NONE = 0;
export const PTT_DISCARD = 1;
export const PTT_SAVE = 2;
export type PttDrop = typeof PTT_NONE | typeof PTT_DISCARD | typeof PTT_SAVE;

/** Extra touch margin around each button (px), so a finger at the edge still counts. */
export const PTT_SLOP = 10;

export const PTT_NO_RECTS: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

function inside(x: number, y: number, rx: number, ry: number, rw: number, rh: number, slop: number): boolean {
  "worklet";
  return rw > 0 && rh > 0 && x >= rx - slop && x <= rx + rw + slop && y >= ry - slop && y <= ry + rh + slop;
}

/**
 * Which button lies under the finger at window point (x, y). Runs on the UI thread.
 * No default parameter on purpose: the worklet compiler evaluates a default before it unpacks the closure, so
 * `slop = PTT_SLOP` threw a ReferenceError on the UI thread and crashed the app on every push-to-talk hold.
 */
export function pttDropTarget(x: number, y: number, rects: readonly number[], slop?: number): PttDrop {
  "worklet";
  if (rects.length < 8 || !Number.isFinite(x) || !Number.isFinite(y)) return PTT_NONE;
  const m = slop === undefined ? PTT_SLOP : slop;
  const d = inside(x, y, rects[0]!, rects[1]!, rects[2]!, rects[3]!, m);
  const s = inside(x, y, rects[4]!, rects[5]!, rects[6]!, rects[7]!, m);
  if (d && s) {
    // Only possible inside the shared slop between the two buttons: the nearer centre wins.
    const dd = Math.abs(x - (rects[0]! + rects[2]! / 2));
    const ds = Math.abs(x - (rects[4]! + rects[6]! / 2));
    return dd <= ds ? PTT_DISCARD : PTT_SAVE;
  }
  if (d) return PTT_DISCARD;
  if (s) return PTT_SAVE;
  return PTT_NONE;
}
