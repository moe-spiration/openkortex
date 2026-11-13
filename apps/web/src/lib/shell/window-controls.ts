/*
 * Window controls of the titlebar (Tactile Craft v2, decision 2): Windows-style minimise / maximise / close,
 * shown only inside the desktop app (Tauri). The titlebar renders them only once a controller is REGISTERED
 * (not merely when isTauri() is true): the desktop app keeps its native window frame until the custom one is
 * switched on, and buttons without a controller would sit next to the native ones without doing anything.
 *
 * ADAPTER POINT (package F, apps/desktop): the web code registers nothing yet. Activating the custom frame is a
 * deliberate, separate step (security review N5 #8, see docs/2026-10-25-desktop.md): grant the window capability
 * to the `main` webview, set `decorations: false`, then call
 * `registerWindowControls(tauriWindowControls(...))` from apps/desktop/src/bridge/windowControls.ts.
 * The titlebar marks itself with data-tauri-drag-region.
 */

export interface WindowControls {
  minimize: () => void | Promise<void>;
  toggleMaximize: () => void | Promise<void>;
  close: () => void | Promise<void>;
}

const NOOP: WindowControls = { minimize: () => {}, toggleMaximize: () => {}, close: () => {} };
let current: WindowControls = NOOP;
let registered = false;
const listeners = new Set<() => void>();

export function registerWindowControls(c: WindowControls | null): void {
  current = c ?? NOOP;
  registered = c !== null;
  for (const l of listeners) l();
}

export function windowControls(): WindowControls {
  return current;
}

/** True once a controller is registered; the titlebar shows its window buttons only then. */
export function hasWindowControls(): boolean {
  return registered;
}

/** Subscribe to (un)registration, for useSyncExternalStore. Returns the unsubscribe function. */
export function subscribeWindowControls(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True inside the Tauri desktop app (v2 sets __TAURI_INTERNALS__, v1 / withGlobalTauri set __TAURI__). */
export function isTauri(w: unknown = typeof window === "undefined" ? undefined : window): boolean {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in o || "__TAURI__" in o;
}
