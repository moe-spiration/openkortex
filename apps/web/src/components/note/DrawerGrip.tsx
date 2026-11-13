"use client";

import { t } from "@/i18n";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DW_MAX, DW_MIN, DW_START, widthForKey, widthFromPointer } from "@/lib/notes/drawer-width";

/*
 * Grip on the drawer's left edge (dummy Grip, decision 6): drag between 30 and 50 % of the canvas, arrow keys move
 * the edge, Home/double click = standard width. A separator with ARIA values, never a visible number.
 */
export function DrawerGrip({ width, setWidth }: { width: number; setWidth: (w: number) => void }) {
  const [drag, setDrag] = useState(false);
  const last = useRef(width);
  last.current = width;

  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const canvas = e.currentTarget.closest(".kx-main-window") ?? e.currentTarget.parentElement?.parentElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setDrag(true);
    document.body.classList.add("is-resizing");
    const move = (ev: globalThis.PointerEvent) => {
      const w = widthFromPointer(ev.clientX, rect);
      if (w !== last.current) setWidth(w);
    };
    const up = () => {
      setDrag(false);
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = widthForKey(e.key, width);
    if (next === null) return;
    e.preventDefault();
    setWidth(next);
  };

  return (
    <div
      className={"kx-dr-grip" + (drag ? " is-drag" : "")}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize the drawer")}
      aria-valuemin={DW_MIN}
      aria-valuemax={DW_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title={t("Drag to resize, double-click for the default width")}
      onPointerDown={start}
      onDoubleClick={() => setWidth(DW_START)}
      onKeyDown={key}
    >
      <span className="kx-dr-grip-pill" />
    </div>
  );
}
