/** Keyboard helpers of the context menu. */

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** The two keys that open a context menu from the keyboard: the Menu key and Shift+F10. */
export const isContextMenuKey = (e: KeyLike): boolean => e.key === "ContextMenu" || (e.key === "F10" && !!e.shiftKey && !e.ctrlKey && !e.altKey);

/** Next highlighted index for a navigation key; wraps around. Returns `null` for other keys. */
export function navigate(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Keeps a menu of `size` fully inside a viewport, preferring the pointer position. */
export function placeMenu(at: { x: number; y: number }, size: { w: number; h: number }, viewport: { w: number; h: number }, margin = 8): { left: number; top: number } {
  const left = at.x + size.w + margin > viewport.w ? Math.max(margin, at.x - size.w) : at.x;
  const top = at.y + size.h + margin > viewport.h ? Math.max(margin, viewport.h - size.h - margin) : at.y;
  return { left: Math.max(margin, left), top: Math.max(margin, top) };
}
