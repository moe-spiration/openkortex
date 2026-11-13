/*
 * Drawer geometry (Tactile Craft v2, decision 6): the note drawer starts at 44 % of the canvas, a toggle switches to
 * half width (50/50), the grip on its left edge resizes it between 28 and 72 % (A2, 2026-11: wider editor). The chosen width is remembered per
 * browser in localStorage (its own key, not the shell store). No numbers are shown anywhere in the UI.
 */

export const DW_START = 44;
export const DW_MIN = 28;
export const DW_MAX = 72;
/** The 50/50 toggle and the split view (drawer.pinned). */
export const DW_HALF = 50;
/** Arrow keys on the grip move the edge by this many percent. */
export const DW_STEP = 2;

export const DRAWER_WIDTH_KEY = "kortex.drawer.v1";

export type DrawerSize = "half" | "full";
/** Value of `data-drawer` on `.kx-main-window` (contract with packages B and D). */
export type DrawerAttr = "none" | "half" | "full";

/** Whole percent between DW_MIN and DW_MAX; anything unusable falls back to DW_START. */
export function clampWidth(w: unknown): number {
  const n = typeof w === "number" ? w : typeof w === "string" ? Number(w) : NaN;
  if (!Number.isFinite(n)) return DW_START;
  return Math.round(Math.min(DW_MAX, Math.max(DW_MIN, n)));
}

/** Width in percent for a pointer at `clientX` over a canvas spanning `left`..`right` (the drawer sits on the right). */
export function widthFromPointer(clientX: number, rect: { left: number; right: number }): number {
  const w = rect.right - rect.left;
  if (w <= 0) return DW_START;
  return clampWidth(((rect.right - clientX) / w) * 100);
}

/** Keyboard on the grip (role="separator"): ←/→ widen/narrow, Home = standard width, End = half. Null = not handled. */
export function widthForKey(key: string, width: number): number | null {
  if (key === "ArrowLeft") return clampWidth(width + DW_STEP);
  if (key === "ArrowRight") return clampWidth(width - DW_STEP);
  if (key === "Home") return DW_START;
  if (key === "End") return DW_MAX;
  return null;
}

/** The 50/50 toggle: half width when not already there, otherwise back to the standard width. */
export function toggleHalf(width: number): number {
  return clampWidth(width) === DW_HALF ? DW_START : DW_HALF;
}

/** `--drawer-w` for `.kx-main-window`: the drawer's share of the canvas while it sits beside the view, else 0%. */
export function drawerCssWidth(attr: DrawerAttr, width: number): string {
  return attr === "half" ? `${clampWidth(width)}%` : "0%";
}

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function readDrawerWidth(store: Store | null = local()): number {
  if (!store) return DW_START;
  try {
    const raw = store.getItem(DRAWER_WIDTH_KEY);
    if (!raw) return DW_START;
    const v = JSON.parse(raw) as { width?: unknown };
    return clampWidth(v?.width);
  } catch {
    return DW_START;
  }
}

export function writeDrawerWidth(width: number, store: Store | null = local()): void {
  if (!store) return;
  try {
    store.setItem(DRAWER_WIDTH_KEY, JSON.stringify({ width: clampWidth(width) }));
  } catch {
    /* storage blocked: the width only lasts for this page */
  }
}
