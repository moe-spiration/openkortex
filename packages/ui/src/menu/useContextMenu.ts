"use client";

import { useCallback, useState, type KeyboardEvent, type MouseEvent } from "react";
import { isContextMenuKey } from "./keys";

export interface OpenMenu<T> {
  at: { x: number; y: number };
  target: T;
}

/**
 * State and event handlers of a context menu on rows: spread `bind(target)` onto a row to open the menu
 * on right-click and on Shift+F10 / the Menu key (then at the row, for keyboard users).
 */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<OpenMenu<T> | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const openAt = useCallback((at: { x: number; y: number }, target: T) => setMenu({ at, target }), []);

  const bind = useCallback(
    (target: T) => ({
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ at: { x: e.clientX, y: e.clientY }, target });
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (!isContextMenuKey(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setMenu({ at: { x: r.left + Math.min(32, r.width / 2), y: r.top + r.height / 2 }, target });
      },
    }),
    [],
  );

  return { menu, bind, close, openAt };
}
