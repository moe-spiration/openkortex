/** Scroll state of a horizontal scroller: can it move further left / right? 4 px tolerance (sub-pixel layouts). */
export interface RailEdges {
  /** Content hidden on the left (not at the start). */
  left: boolean;
  /** Content hidden on the right (not at the end). */
  right: boolean;
}

export const RAIL_EPSILON = 4;

export function railEdges(m: { scrollLeft: number; clientWidth: number; scrollWidth: number }): RailEdges {
  return {
    left: m.scrollLeft > RAIL_EPSILON,
    right: m.scrollLeft + m.clientWidth < m.scrollWidth - RAIL_EPSILON,
  };
}

/** Distance of one arrow click: the given step, or 80 % of the visible width. */
export function railStep(clientWidth: number, step?: number): number {
  return step && step > 0 ? step : Math.max(1, Math.round(clientWidth * 0.8));
}
