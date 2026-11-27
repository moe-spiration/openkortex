// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";
import { onTitlebarMouseDown, runTitlebarPress, titlebarPress } from "./window-drag";

/** The titlebar's DOM as Titlebar.tsx renders it (trimmed to what matters for the press). */
function bar() {
  document.body.innerHTML = `
    <header class="tc-titlebar">
      <div class="tc-tb-left">
        <span class="tc-brand"><span class="kx-appmark"></span><span class="tc-brand-title">Kortex</span></span>
        <button type="button" class="tc-ibtn"><svg class="kx-ico"><path id="btn-path" d="M0 0"></path></svg></button>
      </div>
      <div class="tc-tabs">
        <div role="tablist" style="display: contents">
          <div class="tc-tab" role="tab" tabindex="-1"><span class="tc-tab-label">Note</span><span class="tc-tab-x" aria-hidden="true"><svg><path id="x-path"></path></svg></span></div>
        </div>
        <button type="button" class="tc-ibtn tc-ibtn--sm">+</button>
      </div>
      <div class="tc-tb-right">
        <button type="button" class="tc-search"><span class="tc-search-label">Search</span></button>
        <span class="tc-win" aria-label="Window buttons"><button type="button" class="tc-wbtn">_</button></span>
        <span class="free" data-no-drag>opt-out</span>
        <span class="focusable" tabindex="0">chip</span>
        <span class="editable" contenteditable="true">x</span>
      </div>
    </header>
    <div class="kx-menu" role="menu"><div class="kx-menu-pad">menu padding</div></div>`;
  const header = document.querySelector("header")!;
  const q = (sel: string) => document.querySelector(sel)!;
  return { header, q };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("titlebar press (Windows app: moving the frameless main window)", () => {
  it("drags on every free surface of the bar: the bar itself, logo, brand text, tab strip gap, right group gap", () => {
    const { header, q } = bar();
    for (const sel of ["header", ".tc-tb-left", ".tc-brand", ".kx-appmark", ".tc-brand-title", ".tc-tabs", "[role=tablist]", ".tc-tb-right", ".tc-win"]) {
      expect(titlebarPress(header, q(sel), 0, 1), sel).toBe("drag");
    }
  });

  it("keeps controls: buttons (also their icon paths), tabs and their close x, search, window buttons, focusable, editable, opt-out", () => {
    const { header, q } = bar();
    for (const sel of [".tc-ibtn", "#btn-path", ".tc-tab", ".tc-tab-label", "#x-path", ".tc-ibtn--sm", ".tc-search", ".tc-search-label", ".tc-wbtn", ".free", ".focusable", ".editable"]) {
      expect(titlebarPress(header, q(sel), 0, 1), sel).toBeNull();
    }
  });

  it("double click on a free surface maximises / restores; on a control it does nothing", () => {
    const { header, q } = bar();
    expect(titlebarPress(header, q(".tc-tabs"), 0, 2)).toBe("maximize");
    expect(titlebarPress(header, header, 0, 2)).toBe("maximize");
    expect(titlebarPress(header, q(".tc-tab"), 0, 2)).toBeNull();
    // A triple click is neither (no second toggle).
    expect(titlebarPress(header, q(".tc-tabs"), 0, 3)).toBeNull();
  });

  it("only the left button; nothing for a press outside the bar that reached it through a React portal", () => {
    const { header, q } = bar();
    expect(titlebarPress(header, q(".tc-tabs"), 1, 1)).toBeNull();
    expect(titlebarPress(header, q(".tc-tabs"), 2, 1)).toBeNull();
    expect(titlebarPress(header, q(".kx-menu-pad"), 0, 1)).toBeNull();
    expect(titlebarPress(header, null, 0, 1)).toBeNull();
  });
});

describe("running the press in the desktop app", () => {
  it("drag is Tauri's own start_dragging (native move loop: Aero Snap), falling back to main_window drag", async () => {
    const calls: unknown[] = [];
    const ok = (cmd: string, args?: unknown) => (calls.push([cmd, args]), Promise.resolve(null));
    await runTitlebarPress(ok, "drag");
    expect(calls).toEqual([["plugin:window|start_dragging", undefined]]);
    calls.length = 0;
    const denied = (cmd: string, args?: unknown) => (calls.push([cmd, args]), cmd.startsWith("plugin:") ? Promise.reject(new Error("not allowed")) : Promise.resolve(null));
    await runTitlebarPress(denied, "drag");
    expect(calls).toEqual([
      ["plugin:window|start_dragging", undefined],
      ["main_window", { action: "drag" }],
    ]);
  });

  it("maximise is main_window toggle_maximize, falling back to Tauri's internal toggle; never throws", async () => {
    const calls: unknown[] = [];
    const fail = (cmd: string, args?: unknown) => (calls.push([cmd, args]), Promise.reject(new Error("no")));
    await expect(runTitlebarPress(fail, "maximize")).resolves.toBeUndefined();
    expect(calls).toEqual([
      ["main_window", { action: "toggle_maximize" }],
      ["plugin:window|internal_toggle_maximize", undefined],
    ]);
  });

  it("the handler acts only in the main window of the desktop app and then swallows the press", () => {
    const { header, q } = bar();
    const event = (target: Element, detail = 1) => {
      const preventDefault = vi.fn();
      return { e: { currentTarget: header, target, button: 0, detail, preventDefault } as unknown as ReactMouseEvent<HTMLElement>, preventDefault };
    };
    const invoke = vi.fn(() => Promise.resolve(null));
    const main = { __TAURI_INTERNALS__: { invoke, metadata: { currentWindow: { label: "main" } } } };

    // Browser: nothing, the press stays a normal press.
    const browser = event(q(".tc-tabs"));
    onTitlebarMouseDown(browser.e, {});
    expect(browser.preventDefault).not.toHaveBeenCalled();
    // Another Tauri window (HUD) is not the main window.
    onTitlebarMouseDown(event(q(".tc-tabs")).e, { __TAURI_INTERNALS__: { invoke, metadata: { currentWindow: { label: "hud" } } } });
    expect(invoke).not.toHaveBeenCalled();

    const free = event(q(".tc-brand"));
    onTitlebarMouseDown(free.e, main);
    expect(free.preventDefault).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenLastCalledWith("plugin:window|start_dragging");

    const dbl = event(q(".tc-tabs"), 2);
    onTitlebarMouseDown(dbl.e, main);
    expect(invoke).toHaveBeenLastCalledWith("main_window", { action: "toggle_maximize" });

    invoke.mockClear();
    const tab = event(q(".tc-tab"));
    onTitlebarMouseDown(tab.e, main);
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
