/*
 * Pure helpers of the sidebar favourites (variant A2): the user's own order (prefs.favOrder) applied to the
 * loaded list, and moving one entry by drag and drop or Alt+arrow. Kept free of React so they are tested alone.
 */

/** The loaded items in the stored order; items the order does not know follow in their loaded order. */
export function orderFavorites<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((id, i) => [id, i] as const));
  return items
    .map((it, i) => ({ it, i }))
    .sort(
      (a, b) =>
        (rank.get(a.it.id) ?? order.length + a.i) - (rank.get(b.it.id) ?? order.length + b.i),
    )
    .map((x) => x.it);
}

/**
 * Moves `id` so it sits before the entry that is at index `to` now (to = length puts it last). Returns the new
 * id order of the whole visible list, which becomes the stored order.
 */
export function moveFavorite(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  const rest = ids.filter((x) => x !== id);
  if (from < 0) return [...ids];
  let at = Math.max(0, Math.min(ids.length, to));
  if (at > from) at -= 1;
  rest.splice(Math.min(at, rest.length), 0, id);
  return rest;
}

/** Inserts a new favourite at index `at` (default: end) of the visible order. */
export function insertFavorite(ids: readonly string[], id: string, at?: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(at == null ? rest.length : Math.max(0, Math.min(rest.length, at)), 0, id);
  return rest;
}

/** Window event fired after a star changed anywhere (context menu, editor, graph): the sidebar reloads. */
export const FAVORITES_EVENT = "kortex:favorites";

/** dataTransfer type of a knowledge item dragged out of a list (drop it on the sidebar favourites to pin it). */
export const ITEM_DRAG_TYPE = "application/x-kortex-item";
