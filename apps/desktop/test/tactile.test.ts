import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { announceFrame, currentWindowControls, internalsInvoke, tauriWindowControls } from "@/bridge/windowControls";
import { ACCENT_STORAGE_KEY, FONT_SCALE_KEY, accentHex, applyAccent, applyFontScale, onAccentColor, parseFontScale, readFontScale, resolveAccent } from "@/theme";

describe("window controls adapter (one titlebar: the web app's buttons in main)", () => {
  it("sends every titlebar action through the one command main_window", async () => {
    const invoke = vi.fn(async () => undefined);
    const c = tauriWindowControls(invoke);
    await c.minimize();
    await c.toggleMaximize();
    await c.close();
    await announceFrame(invoke);
    expect(invoke.mock.calls).toEqual([
      ["main_window", { action: "minimize" }],
      ["main_window", { action: "toggle_maximize" }],
      ["main_window", { action: "close" }],
      ["main_window", { action: "frame" }],
    ]);
  });

  it("finds invoke in __TAURI_INTERNALS__, only for main, null in a plain browser", async () => {
    expect(internalsInvoke({})).toBeNull();
    expect(internalsInvoke(null)).toBeNull();
    expect(currentWindowControls({})).toBeNull();
    const calls: unknown[] = [];
    const internals = (label: string) => ({
      metadata: { currentWindow: { label } },
      invoke(this: unknown, cmd: string, args: unknown) {
        calls.push([cmd, args]);
        return Promise.resolve();
      },
    });
    expect(currentWindowControls({ __TAURI_INTERNALS__: internals("hud") })).toBeNull();
    const c = currentWindowControls({ __TAURI_INTERNALS__: internals("main") });
    expect(c).not.toBeNull();
    await c!.minimize();
    expect(calls).toEqual([["main_window", { action: "minimize" }]]);
  });

  it("main has no native frame and the bundled page only its buttons and the drag region", () => {
    const conf = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
      app: { windows: { label: string; decorations?: boolean; minWidth?: number }[] };
    };
    expect(conf.app.windows.find((w) => w.label === "main")?.decorations).toBe(false);
    // Ruhe round 2: Aero Snap to half a screen must fit (1536 px logical at 125 % → 768 px per half).
    expect(conf.app.windows.find((w) => w.label === "main")?.minWidth).toBeLessThanOrEqual(768);
    const cap = (f: string) =>
      JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/capabilities", f), "utf8")) as {
        windows: string[];
        permissions: string[];
        remote?: unknown;
      };
    expect(cap("local.json").windows).not.toContain("main");
    const main = cap("main-local.json");
    expect(main.windows).toEqual(["main"]);
    // No `remote`: it applies to the bundled page only; the web app gets the runtime capability main-web.
    expect(main.remote).toBeUndefined();
    expect(main.permissions).toEqual(["allow-main-window", "core:window:allow-start-dragging", "core:window:allow-internal-toggle-maximize"]);
  });
});

describe("desktop accent (Tactile Craft v2)", () => {
  it("accepts preset ids and hex values", () => {
    expect(accentHex("violet")).toBe("#8B5CF6");
    expect(accentHex("#10b981")).toBe("#10B981");
    expect(accentHex("F97316")).toBe("#F97316");
    expect(accentHex("#abc")).toBe("#AABBCC");
    expect(accentHex("plum")).toBeNull();
    expect(accentHex(null)).toBeNull();
  });

  it("picks the text on the accent fill like the web (shared @kortex/ui/accent, WCAG AA)", () => {
    expect(onAccentColor("#8B5CF6")).toBe("#FFFFFF");
    expect(onAccentColor("#FDE047")).toBe("#111114");
    expect(onAccentColor("nope")).toBe("#FFFFFF");
  });

  it("sets and clears --kx-accent / --kx-accent-fill / --kx-on-accent", () => {
    const el = document.createElement("div");
    expect(applyAccent(el, "#F97316")).toBe("#F97316");
    expect(el.style.getPropertyValue("--kx-accent")).toBe("#F97316");
    // Orange: white reaches only ~3.5:1 on the fill, so the text is the dark ink (5.2:1).
    expect(el.style.getPropertyValue("--kx-on-accent")).toBe("#111114");
    expect(el.style.getPropertyValue("--kx-accent-fill")).toMatch(/^#[0-9A-F]{6}$/);
    expect(applyAccent(el, "")).toBeNull();
    expect(el.style.getPropertyValue("--kx-accent")).toBe("");
    expect(el.style.getPropertyValue("--kx-accent-fill")).toBe("");
  });

  it("prefers ?accent= over the stored desktop accent and survives a broken storage", () => {
    const storage = { getItem: (k: string) => (k === ACCENT_STORAGE_KEY ? "teal" : null) };
    expect(resolveAccent("violet", storage)).toBe("violet");
    expect(resolveAccent(null, storage)).toBe("teal");
    expect(resolveAccent("bogus", null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(resolveAccent(null, broken)).toBeNull();
  });
});

describe("Schriftgröße of the desktop windows", () => {
  it("accepts only the offered steps and writes --kx-fs", () => {
    expect(parseFontScale("0.9")).toBe(0.9);
    expect(parseFontScale("3")).toBe(1);
    expect(parseFontScale(null)).toBe(1);
    expect(readFontScale({ getItem: (k: string) => (k === FONT_SCALE_KEY ? "1.2" : null) })).toBe(1.2);
    expect(readFontScale(null)).toBe(1);
    const el = { style: { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } } };
    applyFontScale(el as unknown as HTMLElement, 0.85);
    expect(el.style.props["--kx-fs"]).toBe("0.85");
  });
});
