// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPEARANCE_KEY, parseAppearance } from "./appearance";
import { PREPAINT_SCRIPT } from "@/lib/shell/prefs";
import { MOTION_CHOICES, applyMotion, motionAttributes, motionChoice, motionOff, resolveMotion } from "./motion";

const d = document.documentElement;
/** Emulates the OS setting (Windows "Animationseffekte" off = prefers-reduced-motion: reduce in WebView2). */
const setOs = (reduce: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  window.localStorage.clear();
  delete d.dataset.motion;
  delete d.dataset.calm;
});
afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("Bewegung: Voll / Reduziert / Aus against the system", () => {
  it("an explicit choice beats the OS, in both directions", () => {
    for (const os of [false, true]) {
      expect(resolveMotion("full", os)).toBe("full");
      expect(resolveMotion("calm", os)).toBe("calm");
      expect(resolveMotion("off", os)).toBe("off");
    }
  });

  it("System follows the OS: reduce -> off, otherwise full", () => {
    expect(resolveMotion("system", false)).toBe("full");
    expect(resolveMotion("system", true)).toBe("off");
  });

  it("nothing picked means System; the old switches still count as a choice", () => {
    expect(motionChoice(undefined)).toBe("system");
    expect(motionChoice(undefined, { off: true })).toBe("off");
    expect(motionChoice(undefined, { calm: true })).toBe("calm");
    expect(motionChoice(undefined, { off: true, calm: true })).toBe("off");
    // A stored choice wins over the old switches.
    expect(motionChoice("full", { off: true, calm: true })).toBe("full");
    expect(motionChoice("nonsense", {})).toBe("system");
    for (const c of MOTION_CHOICES) expect(motionChoice(c)).toBe(c);
  });

  it("maps modes to the <html> attributes the CSS reads", () => {
    expect(motionAttributes("full")).toEqual({ motion: "full", calm: false });
    expect(motionAttributes("calm")).toEqual({ motion: "full", calm: true });
    expect(motionAttributes("off")).toEqual({ motion: "reduced", calm: false });
    applyMotion("calm", d);
    expect([d.dataset.motion, d.dataset.calm]).toEqual(["full", "on"]);
    applyMotion("off", d);
    expect([d.dataset.motion, d.dataset.calm]).toEqual(["reduced", undefined]);
    expect(motionOff()).toBe(true);
    applyMotion("full", d);
    expect(motionOff()).toBe(false);
  });

  it("motionOff asks the OS only before the app set the attribute", () => {
    setOs(true);
    expect(motionOff()).toBe(true);
    applyMotion("full", d);
    expect(motionOff()).toBe(false);
  });

  it("keeps the stored choice when parsing the appearance prefs", () => {
    expect(parseAppearance({ motion: "full" }).motion).toBe("full");
    expect(parseAppearance({ motion: "loud" }).motion).toBeUndefined();
    expect(parseAppearance({}).motion).toBeUndefined();
  });
});

describe("Bewegung before the first paint (pre-paint script)", () => {
  const run = () => new Function(PREPAINT_SCRIPT)();

  it("Voll stays on although Windows reports reduced motion", () => {
    setOs(true);
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ motion: "full" }));
    run();
    expect([d.dataset.motion, d.dataset.calm]).toEqual(["full", undefined]);
  });

  it("Reduziert and Aus win over an OS that allows motion", () => {
    setOs(false);
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ motion: "calm" }));
    run();
    expect([d.dataset.motion, d.dataset.calm]).toEqual(["full", "on"]);
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ motion: "off" }));
    run();
    expect([d.dataset.motion, d.dataset.calm]).toEqual(["reduced", undefined]);
  });

  it("System (nothing picked) follows the OS", () => {
    setOs(true);
    run();
    expect(d.dataset.motion).toBe("reduced");
    setOs(false);
    run();
    expect(d.dataset.motion).toBe("full");
  });

  it("reads the old switches: settings local.motion is Aus, calmMotion is Reduziert", () => {
    setOs(false);
    window.localStorage.setItem("kortex.settings.v1", JSON.stringify({ local: { motion: true } }));
    run();
    expect(d.dataset.motion).toBe("reduced");
    window.localStorage.clear();
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ calmMotion: true }));
    run();
    expect([d.dataset.motion, d.dataset.calm]).toEqual(["full", "on"]);
  });
});
