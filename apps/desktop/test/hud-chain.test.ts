import { describe, expect, it } from "vitest";
import { createMockBridge } from "@/bridge/mock";
import type { Events } from "@/bridge/contract";
import { startsDrag } from "@/components/drag";
import { DEFAULT_DEVICE, deviceLabel, phaseAfterState } from "@/state/desktop";
import { initialMeeting, isAudible, meetingReducer } from "@/state/meeting";

/*
 * 0.6.1 HUD repairs (device test 2026-11-03): dragging, the dead-microphone warning, the meter
 * standing still on silence, the default device's real name, and the self-test's event sequence.
 */

describe("dragging the HUD and the pill", () => {
  it("drags from the surface and from children without the attribute (the grip's SVG)", () => {
    const head = document.createElement("header");
    const grip = document.createElement("span");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    grip.appendChild(svg);
    head.appendChild(grip);
    expect(startsDrag(head, 0)).toBe(true);
    expect(startsDrag(svg, 0)).toBe(true);
  });

  it("small native windows (Ruhe round 2): their title text and spacer move the window, the close button does not", () => {
    const bar = document.createElement("div");
    const name = document.createElement("span");
    const grow = document.createElement("span");
    const close = document.createElement("button");
    const x = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    close.appendChild(x);
    bar.append(name, grow, close);
    expect(startsDrag(name, 0)).toBe(true);
    expect(startsDrag(grow, 0)).toBe(true);
    expect(startsDrag(x, 0)).toBe(false);
  });

  it("leaves buttons, fields and links alone, and only reacts to the left button", () => {
    const head = document.createElement("header");
    const btn = document.createElement("button");
    const icon = document.createElement("span");
    btn.appendChild(icon);
    const input = document.createElement("input");
    head.append(btn, input);
    expect(startsDrag(btn, 0)).toBe(false);
    expect(startsDrag(icon, 0)).toBe(false);
    expect(startsDrag(input, 0)).toBe(false);
    expect(startsDrag(head, 2)).toBe(false);
    expect(startsDrag(null, 0)).toBe(false);
  });
});

describe("levels", () => {
  it("keeps the microphone flag from audio:levels and resets it with a new meeting", () => {
    let s = meetingReducer(initialMeeting(), { type: "levels", a: -60, b: -20, mic: false });
    expect(s.levels).toEqual({ a: -60, b: -20, mic: false });
    s = meetingReducer(s, { type: "levels", a: -18, b: -20 });
    expect(s.levels.mic).toBe(true);
    s = meetingReducer(meetingReducer(s, { type: "levels", a: -60, b: -60, mic: false }), { type: "reset" });
    expect(s.levels.mic).toBe(true);
  });

  it("lets the meter stand still on silence instead of animating", () => {
    expect(isAudible(-60)).toBe(false);
    expect(isAudible(-56)).toBe(false);
    expect(isAudible(-40)).toBe(true);
  });
});

describe("Audio-Setup", () => {
  it("names the device behind the Windows default", () => {
    expect(deviceLabel(DEFAULT_DEVICE, 0, "EMEET Virtual Audio (EMEET Virtual Camera)")).toBe(
      `${DEFAULT_DEVICE}: EMEET Virtual Audio (EMEET Virtual Camera)`,
    );
    expect(deviceLabel(DEFAULT_DEVICE, 0, null)).toBe(DEFAULT_DEVICE);
    expect(deviceLabel("Mic In (Elgato Wave:3)", 2, "x")).toBe("Mic In (Elgato Wave:3)");
  });
});

describe("self-test (mock bridge, same events as the native run)", () => {
  it("drives levels-free events in order: devices, live session, transcript, coaching, upload, done", async () => {
    const b = createMockBridge({ tickMs: 60_000 });
    const seen: string[] = [];
    const names: (keyof Events)[] = ["meeting:devices", "meeting:live", "transcript:final", "coaching:cards", "meeting:upload", "selftest:done"];
    const offs = names.map((n) => b.listen(n, () => seen.push(n)));
    const r = await b.invoke("run_selftest", { online: false });
    offs.forEach((f) => f());
    b.dispose();
    expect(r.ok).toBe(true);
    const first = (n: string) => seen.indexOf(n);
    expect(first("meeting:devices")).toBeLessThan(first("transcript:final"));
    expect(first("transcript:final")).toBeLessThan(first("coaching:cards"));
    expect(first("coaching:cards")).toBeLessThan(first("meeting:upload"));
    expect(seen.at(-1)).toBe("selftest:done");
  }, 10_000);

});

describe("phase after a stop from tray, hotkey or auto-stop (audit D-09)", () => {
  it("waits for a result only when one follows", () => {
    expect(phaseAfterState("live", false, true)).toBe("gen");
    expect(phaseAfterState("live", false, false)).toBe("done");
    // A window that already shows "gen" (stopped in the HUD) does not hang without an upload.
    expect(phaseAfterState("gen", false, false)).toBe("done");
    expect(phaseAfterState("idle", false, false)).toBe("idle");
    expect(phaseAfterState("done", true)).toBe("live");
    // Older cores without the flag: as before.
    expect(phaseAfterState("live", false)).toBe("gen");
    // Discarded: nothing follows, ready for the next recording (also in a window that showed "gen").
    expect(phaseAfterState("live", false, false, true)).toBe("idle");
    expect(phaseAfterState("gen", false, false, true)).toBe("idle");
  });
});
