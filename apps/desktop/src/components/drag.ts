import type { MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/bridge";

/*
 * Moving the frameless HUD and pill windows (device test 0.6.0: "lässt sich nicht verschieben").
 * `data-tauri-drag-region` only reacts when the pressed element itself carries the attribute, so a
 * press on the grip's SVG or on any child did nothing. Instead the whole header / pill surface
 * starts `startDragging()` on mouse down, except on controls.
 */

const CONTROLS = "button, input, textarea, select, a, label, [role='button'], [data-no-drag]";

/** True when a press on `target` should move the window (not on a button, field or link). */
export function startsDrag(target: EventTarget | null, button: number): boolean {
  if (button !== 0) return false;
  const el = target as Element | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest(CONTROLS) === null;
}

/** onMouseDown for a window's drag surface; a no-op outside the desktop app. */
export function dragWindow(e: ReactMouseEvent) {
  if (!isTauri() || !startsDrag(e.target, e.button)) return;
  // A double click would maximize via the OS on some setups: only plain presses drag.
  if (e.detail > 1) return;
  e.preventDefault();
  void getCurrentWindow()
    .startDragging()
    .catch(() => undefined);
}
