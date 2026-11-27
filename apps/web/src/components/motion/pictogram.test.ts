import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PICTOGRAM_KINDS } from "./kinds";
import { GESTURES } from "./gestures";

const styles = resolve(__dirname, "../../../../../packages/ui/src/styles");
const css = readFileSync(resolve(styles, "ruhe-motion.css"), "utf8");
const motionBody = css.slice(0, css.indexOf("/* ---------- Keyframes"));

describe("Ruhe motion (stream D)", () => {
  it("is part of the shared stylesheet", () => {
    expect(readFileSync(resolve(styles, "index.css"), "utf8")).toContain('@import "./ruhe-motion.css"');
  });

  it("animates every pictogram only in the Ruhe look", () => {
    for (const kind of PICTOGRAM_KINDS) expect(css).toMatch(new RegExp(`\\[data-look="ruhe"\\] \\.kx-pic--${kind} `));
  });

  it("Bewegung Aus (data-motion=reduced) stops pictograms, gestures and entrances", () => {
    expect(css).toMatch(/\[data-look="ruhe"\]\[data-motion="reduced"\] :is\(\.kx-pic, \.kx-pic \*, svg\[data-ico\], svg\.lucide,/);
  });

  // Round 2: the OS setting is resolved in lib/settings/motion.ts, so an explicit "Voll" also moves on Windows with
  // "Animationseffekte" off. No stylesheet may ask the media query itself any more.
  it("no stylesheet of the app reads prefers-reduced-motion directly", () => {
    const files = [
      ...readdirSync(styles).filter((f) => f.endsWith(".css")).map((f) => resolve(styles, f)),
      resolve(styles, "../editor/editor.css"),
      resolve(__dirname, "../../app/globals.css"),
    ];
    // Comments may explain the rule; only the CSS itself counts.
    for (const f of files) expect(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), f).not.toContain("prefers-reduced-motion");
  });

  it("Reduziert (data-calm) keeps moving, shorter and without travel", () => {
    expect(css).toContain('[data-look="ruhe"][data-calm="on"] svg:is([data-ico], .lucide) { --kx-g-k: 0.7;');
    expect(css).toContain('[data-look="ruhe"][data-calm="on"] [data-view-host] > * { animation-name: kx-r-fade; }');
  });

  it("keeps every animation rule scoped to the Ruhe look", () => {
    const rules = motionBody.split("}").map((r) => r.trim()).filter((r) => /\banimation(-name)?\s*:|\btransition\s*:/.test(r));
    for (const r of rules) expect(r.split("{").slice(-2, -1)[0]).toContain('[data-look="ruhe"]');
  });
});

describe("icon gestures (10 in the concept)", () => {
  it("has all ten, each with its keyframes", () => {
    expect(Object.keys(GESTURES)).toHaveLength(10);
    for (const g of Object.values(GESTURES)) expect(css).toContain(`@keyframes ${g.keyframes} `);
  });

  it("binds every listed Ico id and Lucide icon to its gesture", () => {
    for (const g of Object.values(GESTURES)) {
      const rule = motionBody.split("\n").find((l) => l.includes(`--kx-g: ${g.keyframes};`));
      expect(rule, g.keyframes).toBeTruthy();
      for (const id of g.ico) expect(rule).toContain(`[data-ico="${id}"]`);
      for (const n of g.lucide) expect(rule).toContain(`.lucide-${n}`);
    }
  });

  it("plays on hover, on keyboard focus and on the action (kx-gesture-play), never in a loop", () => {
    expect(motionBody).toContain(":is(:hover, :focus-visible) > svg:is([data-ico], .lucide)");
    expect(motionBody).toContain(":is(:hover, :focus-visible) > :not(svg) > :not(svg) > svg:is([data-ico], .lucide)");
    expect(motionBody).toContain(".kx-gesture-play > svg:is([data-ico], .lucide)");
    expect(motionBody).toContain("animation-iteration-count: 1;");
  });
});
