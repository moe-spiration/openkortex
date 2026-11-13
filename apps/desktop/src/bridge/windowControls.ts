/*
 * Window buttons of the Tactile Craft titlebar (decision 2: Windows style, only in the desktop app).
 *
 * The web app (package A) draws minimise / maximise / close in its titlebar and calls an adapter,
 * `registerWindowControls({ minimize, toggleMaximize, close })` in apps/web/src/lib/shell/window-controls.ts.
 * The `main` Tauri window loads that web app top-level from a remote URL, so the adapter has to be registered
 * INSIDE the web bundle; the desktop bundle cannot reach it. This module is the ready, tested implementation the
 * web side can copy (or import once it moves to a shared package): it talks to Tauri's core window plugin through
 * `window.__TAURI_INTERNALS__.invoke`, which Tauri injects into every webview, so the web app needs no
 * @tauri-apps/api dependency. The same commands are what @tauri-apps/api/window sends.
 *
 * What it needs to work in `main` (not active yet, see docs/2026-10-25-desktop.md "Tactile Craft v2"):
 *  1. web: registerWindowControls(tauriWindowControls(internalsInvoke(window)!)) when isTauri()
 *  2. desktop: a remote capability for `main` with core:window:allow-minimize, -toggle-maximize, -close and
 *     -start-dragging (data-tauri-drag-region), scoped to the web app's URL
 *  3. desktop: `decorations: false` on `main` (only after 1 and 2, otherwise the window has no working buttons)
 * Closing `main` hides it to the tray (lib.rs CloseRequested), so `close` keeps Kortex running.
 */

export interface WindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
}

export type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Tauri v2 core window commands for the window `label` (default: the current webview's main window). */
export function tauriWindowControls(invoke: Invoke, label = "main"): WindowControls {
  const run = (cmd: string) => async () => {
    await invoke(`plugin:window|${cmd}`, { label });
  };
  return { minimize: run("minimize"), toggleMaximize: run("toggle_maximize"), close: run("close") };
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

/** Window controls for the current Tauri window, or null in a plain browser. */
export function currentWindowControls(w: unknown = typeof window === "undefined" ? undefined : window): WindowControls | null {
  const invoke = internalsInvoke(w);
  return invoke ? tauriWindowControls(invoke, currentLabel(w) ?? "main") : null;
}

/**
 * The capability `main` needs for the web titlebar buttons (prepared, not shipped: shipping it before the web side
 * registers the adapter would only widen what the remote page may call). Kept here so a test pins its shape.
 */
export function mainWindowControlsCapability(webUrls: string[]) {
  return {
    $schema: "../gen/schemas/desktop-schema.json",
    identifier: "main-window-controls",
    description:
      "Titlebar buttons of the remote web app in `main` (Tactile Craft v2): minimise, maximise, close (to tray) and dragging. Nothing else.",
    windows: ["main"],
    remote: { urls: webUrls },
    permissions: [
      "core:window:allow-minimize",
      "core:window:allow-toggle-maximize",
      "core:window:allow-close",
      "core:window:allow-start-dragging",
    ],
  };
}
