import { useCallback, useEffect, useMemo, useState } from "react";
import { EMPTY_SELECTION, clearSelection, pruneSelection, selectAll, toggleSelect, type SelectionState } from "@kortex/ui/menu-model";

/*
 * Selection mode of a list (feedback round 2, #4 on mobile): a long-press starts it with that row, taps
 * add / remove rows, the last removal ends it. Same state logic as the web lists (`@kortex/ui/menu-model`).
 */
export function useSelection(order: readonly string[]) {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);
  const key = order.join("|");
  const stable = useMemo(() => order, [key]);

  // Rows that left the list (archived, deleted, filtered away) leave the selection too.
  useEffect(() => setState((s) => pruneSelection(s, stable)), [stable]);

  const start = useCallback((id: string) => setState({ selected: new Set([id]), anchor: id }), []);
  const toggle = useCallback((id: string) => setState((s) => toggleSelect(s, id)), []);
  const clear = useCallback(() => setState(clearSelection()), []);
  const all = useCallback(() => setState(selectAll(stable)), [stable]);

  return { active: state.selected.size > 0, count: state.selected.size, selected: state.selected, ids: [...state.selected], has: (id: string) => state.selected.has(id), start, toggle, clear, all, total: stable.length };
}
