import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { emit as tauriEmit, listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Bridge, CommandName, EventName, Events, Unlisten } from "./contract";
import { createMockBridge } from "./mock";

export type * from "./contract";

/** Tauri v2 injects this object into every webview it owns. */
export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Real bridge over @tauri-apps/api (only constructed inside Tauri). */
function createTauriBridge(): Bridge {
  return {
    native: true,
    invoke: ((cmd: CommandName, args?: Record<string, unknown>) =>
      tauriInvoke(cmd, args)) as Bridge["invoke"],
    listen: <E extends EventName>(event: E, cb: (payload: Events[E]) => void): Unlisten => {
      let off: (() => void) | null = null;
      let cancelled = false;
      void tauriListen<Events[E]>(event, (e) => cb(e.payload)).then((un) => {
        if (cancelled) un();
        else off = un;
      });
      return () => {
        cancelled = true;
        off?.();
      };
    },
    emit: (event, payload) => void tauriEmit(event, payload),
    // Small windows are created on demand (open_window) and only hidden, so they reopen fast.
    hideWindow: () => void getCurrentWindow().hide(),
  };
}

let instance: Bridge | null = null;

/** The app-wide bridge: Tauri inside the desktop app, the mock in the browser preview. */
export function bridge(): Bridge {
  instance ??= isTauri() ? createTauriBridge() : createMockBridge();
  return instance;
}

/** Tests only: install a bridge (for example a mock with its own clock) before the first bridge() call. */
export function setBridgeForTests(b: Bridge | null): void {
  instance = b;
}
