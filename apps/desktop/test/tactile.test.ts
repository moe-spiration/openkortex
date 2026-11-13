import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  currentWindowControls,
  internalsInvoke,
  mainWindowControlsCapability,
  tauriWindowControls,
} from "@/bridge/windowControls";
import { ACCENT_STORAGE_KEY, FONT_SCALE_KEY, accentHex, applyAccent, applyFontScale, onAccentColor, parseFontScale, readFontScale, resolveAccent } from "@/theme";

describe("window controls adapter (web titlebar buttons in the desktop app)", () => {
  it("sends Tauri's core window commands for the given window", async () => {
    const invoke = vi.fn(async () => undefined);
    const c = tauriWindowControls(invoke, "main");
    await c.minimize();
    await c.toggleMaximize();
    await c.close();
    expect(invoke.mock.calls).toEqual([
      ["plugin:window|minimize", { label: "main" }],
      ["plugin:window|toggle_maximize", { label: "main" }],
      ["plugin:window|close", { label: "main" }],
    ]);
  });

  it("finds invoke and the window label in __TAURI_INTERNALS__, null in a plain browser", async () => {
    expect(internalsInvoke({})).toBeNull();
    expect(internalsInvoke(null)).toBeNull();
    expect(currentWindowControls({})).toBeNull();
    const calls: unknown[] = [];
    const internals = {
      metadata: { currentWindow: { label: "main" } },
      invoke(this: unknown, cmd: string, args: unknown) {
        calls.push([this === internals, cmd, args]);
        return Promise.resolve();
      },
    };
    const c = currentWindowControls({ __TAURI_INTERNALS__: internals });
    expect(c).not.toBeNull();
    await c!.minimize();
    expect(calls).toEqual([[true, "plugin:window|minimize", { label: "main" }]]);
  });

  it("prepares a remote capability that only allows the four titlebar actions", () => {
    const cap = mainWindowControlsCapability(["https://kortex.example.com/*"]);
    expect(cap.windows).toEqual(["main"]);
    expect(cap.remote.urls).toEqual(["https://kortex.example.com/*"]);
    expect(cap.permissions).toEqual([
      "core:window:allow-minimize",
      "core:window:allow-toggle-maximize",
      "core:window:allow-close",
      "core:window:allow-start-dragging",
    ]);
  });

  it("is not active yet: main keeps native decorations and gets no capability until the web registers it", () => {
    const conf = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
      app: { windows: { label: string; decorations?: boolean }[] };
    };
    expect(conf.app.windows.find((w) => w.label === "main")?.decorations).toBe(true);
    const local = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/capabilities/local.json"), "utf8")) as {
      windows: string[];
    };
    expect(local.windows).not.toContain("main");
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
