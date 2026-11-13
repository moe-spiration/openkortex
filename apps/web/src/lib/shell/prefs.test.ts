// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { APPEARANCE_KEY } from "@/lib/settings/appearance";
import { GPU_KEY } from "@/lib/settings/gpu";
import { DEFAULT_PREFS, PREFS_KEY, PREPAINT_SCRIPT, applyDocumentPrefs, loadPrefs } from "./prefs";

const d = document.documentElement;
const runPrepaint = () => new Function(PREPAINT_SCRIPT)();

beforeEach(() => {
  window.localStorage.clear();
  for (const k of Object.keys(d.dataset)) delete d.dataset[k];
  d.removeAttribute("style");
});

describe("pre-paint script (Tactile Craft prefs before hydration)", () => {
  it("applies theme, sidebar, accent, on-accent and the appearance attributes", () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "light", accent: "#FDE047", sidebarClosed: true, rail: false }));
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ backdrop: "pack", density: "dicht" }));
    runPrepaint();
    expect({ ...d.dataset }).toEqual({ theme: "light", rail: "false", sb: "closed", backdrop: "pack", density: "dicht", glass: "on" });
    expect(d.style.getPropertyValue("--kx-accent")).toBe("#FDE047");
    expect(d.style.getPropertyValue("--kx-on-accent")).toBe("#111114");
    expect(d.style.getPropertyValue("--kx-accent-fill")).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("defaults without stored prefs; reduced transparency keeps the glow", () => {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ backdrop: "pack", reduceTransparency: true }));
    runPrepaint();
    expect({ ...d.dataset }).toMatchObject({ sb: "open", backdrop: "glow", density: "kompakt", glass: "solid" });
    expect(d.style.getPropertyValue("--kx-on-accent")).toBe("#FFFFFF");
  });

  it("a stored software-render probe paints glass solid from the first frame, the backdrop choice stays", () => {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ backdrop: "pack" }));
    window.localStorage.setItem(GPU_KEY, "soft");
    runPrepaint();
    expect({ ...d.dataset }).toMatchObject({ backdrop: "pack", glass: "solid" });
    window.localStorage.setItem(GPU_KEY, "hw");
    runPrepaint();
    expect(d.dataset.glass).toBe("on");
  });
});

describe("shell prefs", () => {
  it("old stored prefs get the new defaults (sidebar open, no system theme)", () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "light", accent: "teal" }));
    const p = loadPrefs();
    expect(p).toMatchObject({ theme: "light", accent: "teal", followSystem: false, sidebarClosed: false });
    expect(DEFAULT_PREFS.sidebarClosed).toBe(false);
  });

  it("applyDocumentPrefs mirrors the sidebar state and the on-accent colour", () => {
    applyDocumentPrefs({ theme: "dark", rail: true, accent: "violet", sidebarClosed: true });
    expect({ ...d.dataset }).toEqual({ theme: "dark", rail: "true", sb: "closed" });
    expect(d.style.getPropertyValue("--kx-accent")).toBe("#8B5CF6");
    expect(d.style.getPropertyValue("--kx-on-accent")).toBe("#FFFFFF");
  });
});
