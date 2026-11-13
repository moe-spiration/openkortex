"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EMPTY_SELECTION, clearSelection, clickSelect, pruneSelection, selectAll, type SelectionState } from "@kortex/ui";

/*
 * Selection of rows in a list (feedback round 2, #4). Click with Ctrl / Cmd toggles, Shift selects a range,
 * a plain click selects one row while a selection is active (otherwise it keeps its normal job: open),
 * Ctrl+A selects everything, Esc clears.
 */

export interface RowClick {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function useListSelection(order: readonly string[], opts: { enabled?: boolean; onDelete?: (ids: string[]) => void } = {}) {
  const enabled = opts.enabled !== false;
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);
  const key = order.join("\u0000");
  const stableOrder = useMemo(() => order, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows that left the list (archived, moved, filtered) leave the selection too.
  useEffect(() => setState((s) => pruneSelection(s, stableOrder)), [stableOrder]);

  const count = state.selected.size;

  /** Returns true when the click was a selection click, so the row must not open. */
  const onRowClick = useCallback(
    (id: string, e: RowClick): boolean => {
      if (!enabled) return false;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl && !e.shiftKey && state.selected.size === 0) return false;
      setState((s) => clickSelect(s, id, stableOrder, ctrl || e.shiftKey ? { ctrl, shift: e.shiftKey } : { ctrl: true }));
      return true;
    },
    [enabled, state.selected.size, stableOrder],
  );

  const clear = useCallback(() => setState(clearSelection()), []);
  const all = useCallback(() => setState(selectAll(stableOrder)), [stableOrder]);
  /** Makes sure a row is selected before its context menu opens (right-click on an unselected row selects it alone). */
  const focusRow = useCallback((id: string) => setState((s) => (s.selected.has(id) ? s : { selected: new Set([id]), anchor: id })), []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
        if (!stableOrder.length) return;
        e.preventDefault();
        setState(selectAll(stableOrder));
      } else if (e.key === "Escape" && count > 0) {
        setState(clearSelection());
      } else if ((e.key === "Delete" || e.key === "Backspace") && count > 0 && opts.onDelete) {
        e.preventDefault();
        opts.onDelete([...state.selected]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, stableOrder, count, state.selected, opts]);

  return { state, count, selected: state.selected, onRowClick, clear, all, focusRow, setState };
}
