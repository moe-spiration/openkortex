"use client";

import { t } from "@/i18n";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { clampWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, widthForKey } from "./sidebar-width";

/*
 * Drag handle on the sidebar's right edge (feedback round 2 #5). Drag to resize (200-360 px),
 * double-click for the default width. Keyboard: the handle is a focusable separator; arrows change the
 * width by 10 px (Shift: 40 px), Home/End go to the limits, Enter resets. Hidden in the rail and in
 * the mobile drawer (CSS).
 */
export function SidebarResizer({
  width,
  onChange,
  onCommit,
}: {
  width: number;
  /** Live width while dragging (not stored yet). */
  onChange: (w: number) => void;
  /** Final width: stored. */
  onCommit: (w: number) => void;
}) {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width, last: width };
    document.documentElement.classList.add("kx-resizing");
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const w = clampWidth(d.w + e.clientX - d.x);
    if (w === d.last) return;
    d.last = w;
    onChange(w);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.documentElement.classList.remove("kx-resizing");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.last !== d.w) onCommit(d.last);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const w = widthForKey(width, e.key, e.shiftKey);
    if (w === null) return;
    e.preventDefault();
    onCommit(w);
  };

  return (
    <div
      className="kx-sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Width of the sidebar")}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      aria-valuetext={t("{width} pixels", { width })}
      tabIndex={0}
      title={t("Dragging changes the width, a double click resets it (arrow keys, Enter)")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onCommit(SIDEBAR_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
}
