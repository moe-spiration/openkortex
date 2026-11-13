/*
 * List selection (feedback round 2, #4): click, Ctrl/Cmd+click, Shift+click ranges, select all, clear.
 * Pure state, shared by the web lists and the mobile selection mode.
 */

export interface SelectionState {
  selected: ReadonlySet<string>;
  /** The row a Shift+click range starts from. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

export interface ClickModifiers {
  /** Ctrl (Windows / Linux) or Cmd (macOS). */
  ctrl?: boolean;
  shift?: boolean;
}

const rangeBetween = (order: readonly string[], a: string, b: string): string[] => {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
};

/** Result of a click on row `id` while `order` is the visible row order. */
export function clickSelect(state: SelectionState, id: string, order: readonly string[], mod: ClickModifiers = {}): SelectionState {
  if (mod.shift && state.anchor) {
    const range = rangeBetween(order, state.anchor, id);
    return { selected: new Set(mod.ctrl ? [...state.selected, ...range] : range), anchor: state.anchor };
  }
  if (mod.ctrl) return toggleSelect(state, id);
  return { selected: new Set([id]), anchor: id };
}

/** Adds or removes one row (Ctrl+click, and plain taps once a selection mode is active). */
export function toggleSelect(state: SelectionState, id: string): SelectionState {
  const next = new Set(state.selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { selected: next, anchor: id };
}

export const selectAll = (order: readonly string[]): SelectionState => ({ selected: new Set(order), anchor: order[0] ?? null });

export const clearSelection = (): SelectionState => EMPTY_SELECTION;

/** Drops rows that left the list (archived, moved, filtered away). Returns the same state when nothing changed. */
export function pruneSelection(state: SelectionState, order: readonly string[]): SelectionState {
  if (!state.selected.size) return state;
  const live = new Set(order);
  const kept = [...state.selected].filter((id) => live.has(id));
  if (kept.length === state.selected.size) return state;
  return { selected: new Set(kept), anchor: state.anchor && live.has(state.anchor) ? state.anchor : (kept[0] ?? null) };
}

/** Ids a menu action applies to: the whole selection when the row is part of it, otherwise just the row. */
export function targetsOf(state: SelectionState, id: string): string[] {
  return state.selected.has(id) ? [...state.selected] : [id];
}
