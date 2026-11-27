import { afterEach, describe, expect, it, vi } from "vitest";
import { FRAME_REANNOUNCE_MS, connectDesktopWindow, hasWindowControls, isTauri, registerWindowControls, subscribeWindowControls, windowControls } from "./window-controls";

afterEach(() => registerWindowControls(null));

describe("window controls", () => {
  it("has no controller by default, also inside Tauri", () => {
    expect(isTauri({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(hasWindowControls()).toBe(false);
  });

  it("shows the buttons only after a controller is registered and notifies subscribers", () => {
    const listener = vi.fn();
    const off = subscribeWindowControls(listener);
    const c = { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() };
    registerWindowControls(c);
    expect(hasWindowControls()).toBe(true);
    void windowControls().close();
    expect(c.close).toHaveBeenCalledOnce();
    registerWindowControls(null);
    expect(hasWindowControls()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    registerWindowControls(c);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("detects Tauri v1 and v2 globals only", () => {
    expect(isTauri({ __TAURI__: {} })).toBe(true);
    expect(isTauri({})).toBe(false);
    expect(isTauri(undefined)).toBe(false);
  });

  it("desktop: takes over main's frame only when the core accepts it, then every button is main_window", async () => {
    const internals = (label: string, ok: boolean) => {
      const calls: unknown[] = [];
      return {
        calls,
        metadata: { currentWindow: { label } },
        invoke: (cmd: string, args: unknown) => {
          calls.push([cmd, args]);
          return ok ? Promise.resolve(null) : Promise.reject(new Error("unknown command"));
        },
      };
    };
    expect(await connectDesktopWindow({})).toBe(false);
    const hud = internals("hud", true);
    expect(await connectDesktopWindow({ __TAURI_INTERNALS__: hud })).toBe(false);
    expect(hud.calls).toEqual([]);
    // An older desktop app without the command keeps its native frame: no buttons.
    const old = internals("main", false);
    expect(await connectDesktopWindow({ __TAURI_INTERNALS__: old })).toBe(false);
    expect(hasWindowControls()).toBe(false);
    const main = internals("main", true);
    expect(await connectDesktopWindow({ __TAURI_INTERNALS__: main })).toBe(true);
    expect(hasWindowControls()).toBe(true);
    await windowControls().minimize();
    await windowControls().toggleMaximize();
    await windowControls().close();
    expect(main.calls).toEqual([
      ["main_window", { action: "frame" }],
      ["main_window", { action: "minimize" }],
      ["main_window", { action: "toggle_maximize" }],
      ["main_window", { action: "close" }],
    ]);
  });

  it("says frame once more after the page load (the core resets its flag when it sees the load finish)", async () => {
    // A new module instance: connectDesktopWindow keeps its promise per page.
    vi.resetModules();
    const mod = await import("./window-controls");
    const calls: unknown[] = [];
    const timers: (() => void)[] = [];
    let onLoad: (() => void) | undefined;
    const w = {
      __TAURI_INTERNALS__: { metadata: { currentWindow: { label: "main" } }, invoke: (cmd: string, args: unknown) => (calls.push([cmd, args]), Promise.resolve(null)) },
      document: { readyState: "interactive" },
      addEventListener: (type: string, l: () => void) => type === "load" && (onLoad = l),
      setTimeout: (f: () => void, ms: number) => (expect(ms).toBe(FRAME_REANNOUNCE_MS), timers.push(f)),
    };
    expect(await mod.connectDesktopWindow(w)).toBe(true);
    expect(calls).toEqual([["main_window", { action: "frame" }]]);
    expect(timers).toHaveLength(0);
    onLoad?.();
    timers.forEach((f) => f());
    expect(calls).toEqual([
      ["main_window", { action: "frame" }],
      ["main_window", { action: "frame" }],
    ]);
    mod.registerWindowControls(null);
  });
});
