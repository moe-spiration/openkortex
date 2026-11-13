/*
 * Sidebar width (feedback round 2 #5): 200-360 px, default 236 px (Tactile Craft, `--layout-sidebar`), stored per
 * device in localStorage like the group states (Q6). Pure helpers, unit-tested.
 */

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;
export const SIDEBAR_DEFAULT = 236;
/** Arrow key step; with Shift the step is four times larger. */
export const SIDEBAR_STEP = 10;

const KEY = "kortex.sidebar.width.v1";

export const clampWidth = (w: number): number =>
  Number.isFinite(w) ? Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w))) : SIDEBAR_DEFAULT;

/** Stored width, or the default when nothing (valid) is stored or storage is blocked. */
export function readWidth(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampWidth(n) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

/** Stores the width; the default removes the entry. */
export function writeWidth(w: number): void {
  try {
    if (w === SIDEBAR_DEFAULT) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(w));
  } catch {
    /* private mode: the width lasts for this page only */
  }
}

/** New width for a key on the resize handle, or null when the key does not resize. */
export function widthForKey(current: number, key: string, shift: boolean): number | null {
  const step = shift ? SIDEBAR_STEP * 4 : SIDEBAR_STEP;
  switch (key) {
    case "ArrowRight":
      return clampWidth(current + step);
    case "ArrowLeft":
      return clampWidth(current - step);
    case "Home":
      return SIDEBAR_MIN;
    case "End":
      return SIDEBAR_MAX;
    case "Enter":
      return SIDEBAR_DEFAULT;
    default:
      return null;
  }
}
