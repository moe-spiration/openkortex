/*
 * Window controls of the titlebar (Tactile Craft v2, decision 2): Windows-style minimise / maximise / close,
 * shown only inside the desktop app (Tauri). The titlebar renders them only once a controller is REGISTERED
 * (not merely when isTauri() is true), so buttons never sit next to a native frame without doing anything.
 *
 * Desktop (Ruhe D1, desktop 0.6.8): `main` has no native frame; this titlebar is its only one.
 * `connectDesktopWindow()` (components/shell/WindowButtons.tsx calls it once) tells the core `main_window
 * { action: "frame" }` and, only if the core accepts it, registers the controller: every button is the same
 * command with another action (apps/desktop/src-tauri/src/main_bridge.rs, runtime capability `main-web`). An older
 * desktop app without that command rejects the call and keeps its native frame; a newer desktop app that never
 * hears "frame" (older web app) turns its native frame back on after 10 s. Moving the window by its titlebar:
 * window-drag.ts (Ruhe round 2).
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

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Tauri's `invoke` when this page runs in the desktop's `main` window, else null. */
export function mainWindowInvoke(w: unknown): Invoke | null {
  if (!w || typeof w !== "object") return null;
  const internals = (w as { __TAURI_INTERNALS__?: { invoke?: unknown; metadata?: { currentWindow?: { label?: unknown } } } }).__TAURI_INTERNALS__;
  const label = internals?.metadata?.currentWindow?.label;
  if (typeof internals?.invoke !== "function" || (typeof label === "string" && label !== "main")) return null;
  return internals.invoke.bind(internals) as Invoke;
}

let connecting: Promise<boolean> | null = null;

/** Delay after the page's load event for the second "frame" (the core's page-load watcher runs around then). */
export const FRAME_REANNOUNCE_MS = 1500;

/**
 * The core (0.6.8) resets its "frame" flag when it sees the page load finish and puts the native frame back 10 s
 * later if no "frame" came after that. Next.js hydrates before the load event, so the first "frame" can arrive
 * before that reset: say it once more shortly after load (Ruhe round 2; idempotent in the core).
 */
function reannounceAfterLoad(w: unknown, invoke: Invoke): void {
  const win = w as { document?: { readyState?: string }; addEventListener?: (t: string, l: () => void, o?: { once: boolean }) => void; setTimeout?: (f: () => void, ms: number) => unknown };
  if (typeof win.setTimeout !== "function") return;
  const later = () => void win.setTimeout?.(() => void invoke("main_window", { action: "frame" }).catch(() => undefined), FRAME_REANNOUNCE_MS);
  if (win.document?.readyState === "complete" || typeof win.addEventListener !== "function") later();
  else win.addEventListener("load", later, { once: true });
}

/**
 * Desktop app: take over the window frame of `main` and register the buttons (once per page). Resolves to true when
 * the buttons are live, false in a browser or an older desktop app (which keeps its native frame).
 */
export function connectDesktopWindow(w: unknown = typeof window === "undefined" ? undefined : window): Promise<boolean> {
  const invoke = mainWindowInvoke(w);
  if (!invoke) return Promise.resolve(false);
  connecting ??= invoke("main_window", { action: "frame" }).then(
    () => {
      const run = (action: string) => async () => {
        await invoke("main_window", { action });
      };
      registerWindowControls({ minimize: run("minimize"), toggleMaximize: run("toggle_maximize"), close: run("close") });
      reannounceAfterLoad(w, invoke);
      return true;
    },
    () => {
      connecting = null;
      return false;
    },
  );
  return connecting;
}
