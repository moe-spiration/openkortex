import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getMotionChoice, isMotionChoice, motionDurations, motionLabel, nextMotionChoice, resolveMotion, setMotionChoice, subscribeMotionChoice } from "../src/lib/motionPref";
import { RUHE_MOTION, ruheWeight } from "../src/theme/tokens";
import { ICONS } from "../src/ui/iconShapes";
import { GESTURE_OF, GESTURES } from "../src/ui/ruhe/gestures";
import { bezierAt, cubicPoint, EIO, EO, LIN, loopAt, SPR, trackAt, type Track } from "../src/ui/ruhe/keyframes";
import { AGENT, AGENT_IDLE, IDEA, IDEA_RAYS, INBOX, PICTOGRAM_KINDS, PICTOGRAM_SIZE, SEARCH, SEARCH_ROWS, STACK, SYNC, type LayerSpec } from "../src/ui/ruhe/pictogramSpec";

/* Ruhe round 2 on Android: Bewegung beats the system, pictograms and icon gestures as keyframe tracks, finer type. */

describe("Bewegung (motion choice)", () => {
  it("lets an explicit choice beat Android's reduce motion; only System follows it", () => {
    expect(resolveMotion("system", false)).toBe("full");
    expect(resolveMotion("system", true)).toBe("off");
    expect(resolveMotion("full", true)).toBe("full");
    expect(resolveMotion("calm", true)).toBe("calm");
    expect(resolveMotion("off", false)).toBe("off");
  });

  it("cycles System, Full, Reduced, Off and names them in German", () => {
    expect(["system", "full", "calm", "off"].map((c) => nextMotionChoice(c as never))).toEqual(["full", "calm", "off", "system"]);
    expect(["system", "full", "calm", "off"].map((c) => motionLabel(c as never))).toEqual(["System", "Voll", "Reduziert", "Aus"]);
    expect(isMotionChoice("calm")).toBe(true);
    expect(isMotionChoice("reduced")).toBe(false);
  });

  it("holds the current choice and tells subscribers", () => {
    const seen: string[] = [];
    const off = subscribeMotionChoice(() => seen.push(getMotionChoice()));
    setMotionChoice("calm");
    setMotionChoice("calm");
    setMotionChoice("system");
    off();
    expect(seen).toEqual(["calm", "system"]);
  });

  it("keeps the tokens on Full, a third shorter on Reduced, short fades on Off", () => {
    expect(motionDurations("full")).toEqual({ d1: 120, d2: 180, d3: 260, d4: 420 });
    expect(motionDurations("calm")).toEqual({ d1: 84, d2: 126, d3: 182, d4: 294 });
    expect(motionDurations("off")).toEqual({ d1: 120, d2: 120, d3: 120, d4: 120 });
  });

  it("is stored with the device prefs and mounted at the root", () => {
    const state = readFileSync(join(__dirname, "..", "src", "state", "AppState.tsx"), "utf8");
    expect(state).toMatch(/JSON\.stringify\(\{ themePref, accent, look, haptics, motion \}\)/);
    const layout = readFileSync(join(__dirname, "..", "app", "_layout.tsx"), "utf8");
    expect(layout).toContain("<MotionConfig />");
  });
});

describe("keyframe tracks", () => {
  it("uses the curves of the motion tokens", () => {
    // Points on the CSS curves: eo rises fast, eio is symmetric, spring overshoots.
    expect(bezierAt(...RUHE_MOTION.eo, 0.5)).toBeGreaterThan(0.9);
    expect(bezierAt(...RUHE_MOTION.eio, 0.5)).toBeCloseTo(0.5, 2);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((x) => bezierAt(...RUHE_MOTION.spring, x)))).toBeGreaterThan(1);
    expect(bezierAt(0, 0, 1, 1, 0.3)).toBeCloseTo(0.3, 2);
  });

  it("interpolates per segment and holds the ends", () => {
    const tr: Track = { at: [0, 0.5, 1], v: [0, 10, 0], e: LIN };
    expect(trackAt(tr, -1, false)).toBe(0);
    expect(trackAt(tr, 0.25, false)).toBeCloseTo(5);
    expect(trackAt(tr, 0.5, false)).toBe(10);
    expect(trackAt(tr, 2, false)).toBe(0);
    // Reduziert runs spring segments on eo (no overshoot).
    const spring: Track = { at: [0, 1], v: [0, 1], e: SPR };
    expect(trackAt(spring, 0.7, false)).toBeGreaterThan(1);
    expect(trackAt(spring, 0.7, true)).toBeLessThanOrEqual(1);
  });

  it("loops with a delay like animation-delay", () => {
    expect(loopAt(500, 2000, 0)).toBe(0.25);
    expect(loopAt(500, 2000, 1000)).toBe(0.75);
    expect(loopAt(4500, 2000, 0)).toBe(0.25);
    expect(cubicPoint([44, 60, 60, 30, 90, 30, 106, 60], 0.5)).toEqual({ x: 75, y: 37.5 });
  });
});

const layers = (): [string, LayerSpec][] => [
  ...Object.entries(INBOX),
  ...Object.entries(AGENT),
  ...Object.entries(AGENT_IDLE),
  ...Object.entries(SYNC),
  ...Object.entries(STACK),
  ...SEARCH.rows.map((r, i) => [`row${i}`, r] as [string, LayerSpec]),
  ["lens", SEARCH.lens],
  ["halo", IDEA.halo],
  ...IDEA.rays.map((r, i) => [`ray${i}`, r] as [string, LayerSpec]),
];

describe("pictograms (motion-demos.html)", () => {
  it("has the six kinds in three sizes, a step finer when large", () => {
    expect(PICTOGRAM_KINDS).toEqual(["inbox", "agent", "sync", "stack", "search", "idea"]);
    expect(PICTOGRAM_SIZE.md).toMatchObject({ w: 150, h: 120 });
    expect(PICTOGRAM_SIZE.lg.line).toBeLessThan(PICTOGRAM_SIZE.md.line);
    expect(SEARCH_ROWS).toHaveLength(SEARCH.rows.length);
    expect(IDEA_RAYS).toHaveLength(IDEA.rays.length);
  });

  it("loops slowly (2 s and more) with well-formed tracks", () => {
    for (const [name, l] of layers()) {
      expect(l.period, name).toBeGreaterThanOrEqual(1200);
      for (const tr of [l.o, l.x, l.y, l.r, l.s, l.dash].filter(Boolean) as Track[]) {
        expect(tr.at.length, name).toBe(tr.v.length);
        expect(tr.at[0], name).toBe(0);
        expect(tr.at[tr.at.length - 1], name).toBe(1);
        expect([...tr.at].sort((a, b) => a - b), name).toEqual(tr.at);
        expect([LIN, EO, EIO, SPR], name).toContain(tr.e);
      }
    }
  });

  it("matches the concept's key moments", () => {
    // Inbox: the sheet falls in from 46 above and lands; the check is drawn at 70 %.
    expect(trackAt(INBOX.sheet.y!, 0, false)).toBe(-46);
    expect(trackAt(INBOX.sheet.y!, 0.6, false)).toBe(0);
    expect(trackAt(INBOX.check.dash!, 0.5, false)).toBe(30);
    expect(trackAt(INBOX.check.dash!, 0.75, false)).toBe(0);
    // Agent: one turn in 9 s, idle much slower without travelling wires.
    expect(AGENT.orb.period).toBe(9000);
    expect(AGENT_IDLE.orb.period).toBeGreaterThan(AGENT.orb.period * 2);
    expect((AGENT_IDLE.wire as LayerSpec).dash).toBeUndefined();
    // Stack: the check pops only at the end of the fan.
    expect(trackAt(STACK.ok.s!, 0.5, false)).toBe(0);
    expect(trackAt(STACK.ok.s!, 0.95, false)).toBe(1);
    // Search rows shimmer one after another.
    expect(SEARCH.rows.map((r) => r.delay)).toEqual([0, 250, 500, 750]);
  });

  it("shows a calm still picture when Bewegung is off", () => {
    for (const [name, l] of layers()) expect(l.rest.o, name).toBeGreaterThan(0);
    expect(IDEA.halo.rest.o).toBe(0.2);
    expect(SYNC.packetA.rest.x).toBe(0.5);
  });
});

describe("icon gestures", () => {
  it("gives the ten gestures of the concept to the main icons, once and under 700 ms", () => {
    expect(Object.keys(GESTURES).sort()).toEqual(["draw", "level", "lid", "pulse", "ring", "settle", "spin", "starpop", "twinkle", "up"]);
    for (const [k, g] of Object.entries(GESTURES)) expect(g.dur, k).toBeLessThanOrEqual(700);
    for (const n of ["mic", "send", "arrowUp", "check", "star", "bell", "sparkles", "inbox", "archive"] as const) expect(GESTURE_OF[n], n).toBeDefined();
    for (const n of Object.keys(GESTURE_OF)) expect(ICONS, n).toHaveProperty(n);
  });

  it("ends every gesture where it started", () => {
    const rest = { r: 0, s: 1, sy: 1, x: 0, y: 0, o: 1, reveal: 1 };
    for (const [k, g] of Object.entries(GESTURES))
      for (const prop of ["s", "sy", "x", "y", "o", "reveal"] as const) {
        const tr = g[prop];
        if (tr) expect(trackAt(tr, 1, false), `${k}.${prop}`).toBeCloseTo(rest[prop]);
      }
    expect(trackAt(GESTURES.spin.r!, 1, false)).toBe(360);
  });
});

describe("Ruhe type a step finer", () => {
  it("drops bold below title size and keeps page titles", () => {
    expect(ruheWeight(700, 30)).toBe(700);
    expect(ruheWeight(700, 24)).toBe(600);
    expect(ruheWeight(600, 17)).toBe(500);
    expect(ruheWeight(600, 13)).toBe(500);
    expect(ruheWeight(400, 15)).toBe(400);
    expect(ruheWeight(450, 15)).toBe(500);
  });

  it("draws Ruhe icons with 1.4, large ones with 1.25", () => {
    const icon = readFileSync(join(__dirname, "..", "src", "ui", "Icon.tsx"), "utf8");
    expect(icon).toContain("(size >= 20 ? 1.25 : 1.4)");
  });
});
