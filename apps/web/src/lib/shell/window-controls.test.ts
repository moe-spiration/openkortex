import { afterEach, describe, expect, it, vi } from "vitest";
import { hasWindowControls, isTauri, registerWindowControls, subscribeWindowControls, windowControls } from "./window-controls";

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
});
