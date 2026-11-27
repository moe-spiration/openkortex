/*
 * Window buttons of the one titlebar in `main` (Ruhe D1, since 0.6.8): the window has no native frame
 * (`decorations: false`), the web app draws minimise / maximise / close in its own titlebar.
 *
 * The `main` Tauri window loads the web app top-level from a remote URL, so the buttons are wired INSIDE the web
 * bundle (apps/web/src/lib/shell/window-controls.ts, `connectDesktopWindow`); this module is the same adapter for the
 * desktop's own bundled page (MainWindow.tsx) and pins the contract in tests. Both talk to the core through
 * `window.__TAURI_INTERNALS__.invoke`, which Tauri injects into every webview, so the web app needs no
 * @tauri-apps/api dependency.
 *
 * Rights (review N5 #8, keep them small): the remote page gets the runtime capability `main-web` (main_bridge.rs):
 * the five `main_*` commands plus `core:window:allow-start-dragging` and `-internal-toggle-maximize` for
 * `data-tauri-drag-region`. No core window plugin commands: minimise, maximise and close are ONE command,
 * `main_window { action }`, with a closed list of actions. Closing hides `main` to the tray (Kortex keeps running).
 *
 * Handshake: the page says `frame` once it shows its own buttons. A page that does not (an older web app) gets the
 * native frame back after 10 s (main_bridge.rs `watch_frame`), so the window is never left without buttons.
 */

export type WindowAction = "frame" | "minimize" | "toggle_maximize" | "close" | "drag";

export interface WindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
}

export type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The core command behind every titlebar button of `main`. */
export const MAIN_WINDOW_COMMAND = "main_window";

/** The titlebar actions for `main` through `main_window`. */
export function tauriWindowControls(invoke: Invoke): WindowControls {
  const run = (action: WindowAction) => async () => {
    await invoke(MAIN_WINDOW_COMMAND, { action });
  };
  return { minimize: run("minimize"), toggleMaximize: run("toggle_maximize"), close: run("close") };
}

/** Tells the core that the page draws its own window buttons (keeps `decorations: false`). */
export async function announceFrame(invoke: Invoke): Promise<void> {
  await invoke(MAIN_WINDOW_COMMAND, { action: "frame" satisfies WindowAction });
}

/** Tauri's IPC `invoke` from a window object (v2: __TAURI_INTERNALS__), or null outside Tauri. */
export function internalsInvoke(w: unknown): Invoke | null {
  if (!w || typeof w !== "object") return null;
  const internals = (w as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  const invoke = internals?.invoke;
  return typeof invoke === "function" ? (invoke.bind(internals) as Invoke) : null;
}

/** Label of the current webview window from __TAURI_INTERNALS__.metadata, if present. */
export function currentLabel(w: unknown): string | null {
  const meta = (w as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: unknown } } } } | null)
    ?.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  return typeof meta === "string" ? meta : null;
}

/** Window controls when this page runs in the `main` Tauri window, else null (plain browser, other windows). */
export function currentWindowControls(w: unknown = typeof window === "undefined" ? undefined : window): WindowControls | null {
  const invoke = internalsInvoke(w);
  const label = currentLabel(w);
  return invoke && (label === null || label === "main") ? tauriWindowControls(invoke) : null;
}
