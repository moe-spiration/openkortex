/* Pure rules of the W11 navigation drawer (see MobileNav.tsx). */

/** Edge zone (px) where an opening swipe must start, and the minimum horizontal travel of a swipe. */
export const SWIPE_EDGE = 20;
export const SWIPE_MIN = 56;

/**
 * What a finished touch does to the drawer: "close" for a swipe to the left while open, "open" for a
 * swipe to the right that started at the left edge while closed, null otherwise. Short or mostly
 * vertical moves (scrolling) never count.
 */
export function swipeIntent(start: { x: number; y: number }, end: { x: number; y: number }, open: boolean): "open" | "close" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dy) > Math.abs(dx)) return null;
  if (open && dx < 0) return "close";
  if (!open && dx > 0 && start.x <= SWIPE_EDGE) return "open";
  return null;
}
