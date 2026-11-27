import type { MouseEvent as ReactMouseEvent } from "react";
import { mainWindowInvoke } from "./window-controls";

/*
 * Moving the Windows app by the web titlebar (Ruhe round 2, device test 0.6.8: "Das Fenster lässt sich nicht
 * verschieben, nur größer/kleiner ziehen").
 *
 * Cause: since 0.6.8 `main` has no native frame and the web titlebar is its only head. It carried a bare
 * `data-tauri-drag-region` on the <header> only. Tauri's drag script (tauri 2.x, window/scripts/drag.js) reacts to a
 * bare attribute only when the pressed element IS that element, and the logo, the tab strip (flex: 1) and the right
 * group cover almost the whole bar: only the few pixels between them moved the window.
 *
 * Now the titlebar starts the move itself: a press on any surface of the bar that is not a control (button, tab,
 * field, link, anything focusable, or marked data-no-drag) calls Tauri's own `start_dragging`, the native move loop
 * (Aero Snap, drag a maximised window down to restore it). A double click maximises / restores like a native title
 * bar. Rights: `core:window:allow-start-dragging` and `main_window` are granted to the web origin since 0.6.8
 * (main_bridge.rs, runtime capability `main-web`), so this ships with the web deploy, no new installer.
 * In a browser (no Tauri) the handler does nothing.
 */

/** Presses on these keep their own meaning; the list matches Tauri's drag.js plus our own opt-out. */
export const NO_DRAG = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='option']",
  "[role='slider']",
  "[role='textbox']",
  "[role='combobox']",
  "[data-no-drag]",
].join(", ");

export type TitlebarPress = "drag" | "maximize" | null;

/** Element and SVG targets (an icon's <path>) both have closest(); text nodes are never the target of a press. */
const isElement = (v: unknown): v is Element => !!v && typeof (v as Element).closest === "function";

/**
 * What a mouse press on the titlebar `bar` does: "drag" (plain left press on a free surface), "maximize" (the second
 * press of a double click there) or null (a control, another button, a triple click, or a press that only reaches
 * the bar through a React portal such as the New menu).
 */
export function titlebarPress(bar: Pick<Node, "contains">, target: EventTarget | null, button: number, detail: number): TitlebarPress {
  if (button !== 0 || (detail !== 1 && detail !== 2)) return null;
  if (!isElement(target)) return null;
  // React events bubble through portals: a press in the New menu's popup reaches the header's handler.
  if (!bar.contains(target)) return null;
  const control = target.closest(NO_DRAG);
  if (control && bar.contains(control)) return null;
  return detail === 2 ? "maximize" : "drag";
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Runs the press in the desktop app: the native move, or maximise / restore. Fallbacks for other core versions. */
export function runTitlebarPress(invoke: Invoke, press: Exclude<TitlebarPress, null>): Promise<unknown> {
  if (press === "drag") {
    // Tauri's own move loop; a core without that right (a later one may route it) takes main_window "drag".
    return invoke("plugin:window|start_dragging").catch(() => invoke("main_window", { action: "drag" })).catch(() => undefined);
  }
  return invoke("main_window", { action: "toggle_maximize" })
    .catch(() => invoke("plugin:window|internal_toggle_maximize"))
    .catch(() => undefined);
}

/** onMouseDown of the titlebar: moves / maximises the Windows app window; a no-op in a browser. */
export function onTitlebarMouseDown(e: ReactMouseEvent<HTMLElement>, w: unknown = typeof window === "undefined" ? undefined : window): void {
  const invoke = mainWindowInvoke(w);
  if (!invoke) return;
  const press = titlebarPress(e.currentTarget, e.target, e.button, e.detail);
  if (!press) return;
  // No text selection, no focus change: the press belongs to the window.
  e.preventDefault();
  void runTitlebarPress(invoke, press);
}
