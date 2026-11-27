import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it } from "vitest";
import { bridge, setBridgeForTests } from "@/bridge";
import { createMockBridge } from "@/bridge/mock";
import { DesktopProvider, useDesktop } from "@/state/desktop";
import { clockStore } from "@/state/clock";
import { levelStore } from "@/state/levels";
import { MeetingBar } from "@/windows/MeetingBar";

/*
 * fx3 (device test 0.6.1, "HUD wirkt hakelig"): level events (~30/s) must not re-render React.
 * The meters read the level store and write the DOM directly; React only renders on real state
 * changes (transcript, coaching, clock). Numbers for the hand-over: `KX_PERF=1 pnpm vitest run hud-perf`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The mock bridge plays a demo conversation on real timers: two transcript lines 60 ms after start and one more
 * every DEMO_EVERY ticks. Those are real state changes that rightly re-render the HUD. Before, the test raced
 * them: whether the intro landed before or inside the measured window depended on how fast the first render was,
 * and under load (pnpm check, parallel workers) a demo line could land in the tick test. So the clock runs at
 * one tick per hour here, and the test waits for the intro before it measures.
 */
const mock = createMockBridge({ tickMs: 3_600_000 });
setBridgeForTests(mock);

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
afterAll(() => {
  act(() => root.unmount());
  mock.dispose();
  setBridgeForTests(null);
});

const frame = () => new Promise((r) => setTimeout(r, 20));

let renders = 0;
/** The HUD plus a render counter (every context consumer renders when the provider does). */
function CountedHud() {
  useDesktop();
  renders += 1;
  return <MeetingBar />;
}

describe("HUD rendering under level events", () => {
  it("does not re-render on audio:levels and still moves the meters", { timeout: 60_000 }, async () => {
    await act(async () => {
      root.render(
        <DesktopProvider initialMode="hud">
          <CountedHud />
        </DesktopProvider>,
      );
      await frame();
    });
    const hud = host.querySelector(".kxd-hud")!;
    // The mock's intro (meeting:live + two lines) must be in before the measured window starts.
    for (let i = 0; i < 250 && hud.querySelectorAll(".kxd-hud-line").length < 2; i++) await act(frame);
    expect(hud.querySelectorAll(".kxd-hud-line").length).toBeGreaterThanOrEqual(2);
    expect(hud.getAttribute("data-phase")).toBe("live");

    const b = bridge() as ReturnType<typeof bridge> & { emit: (e: string, p: unknown) => void };
    const N = 300;
    let mutations = 0;
    const mo = new MutationObserver((l) => (mutations += l.length));
    mo.observe(hud, { subtree: true, childList: true, attributes: true, characterData: true });
    renders = 0;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const db = -40 + (i % 30);
      act(() => {
        b.emit("audio:levels", { ch0: { db, rms: 0.1 }, ch1: { db: db - 5, rms: 0.05 }, mic_signal: true });
      });
    }
    const script = performance.now() - t0;
    await act(frame);
    mo.disconnect();
    if (process.env.KX_PERF)
      console.log(`hud-perf: ${N} level events -> ${renders} HUD renders, ${script.toFixed(0)} ms script (${(script / N).toFixed(2)} ms/event), ${mutations} DOM mutations`);

    expect(renders).toBe(0);
    // The latest level reached the DOM: the wave's scale and the microphone attribute for the self-test probe
    // (the mock bridge keeps sending its own levels, so compare with the store).
    // The DOM must show a level the store actually held (the mock may send one between the read and
    // the next animation frame, which made an exact comparison flaky).
    const seen = new Set<string>();
    const off = levelStore.subscribe((l) => seen.add(String(Math.round(l.a))));
    await act(frame);
    off();
    const shown = hud.getAttribute("data-mic-db")!;
    expect(seen.has(shown) || shown === String(levelStore.get().a)).toBe(true);
    // The bar's one wave (both channels) moves by transform, without React.
    const wv = hud.querySelector<HTMLElement>(".kxd-mb-wave .kx-wv")!;
    expect(wv.style.transform).toMatch(/^scaleY\(/);
  });

  it("does not re-render the HUD tree on the 1 s meeting:tick, only the clock text", async () => {
    const b = bridge() as ReturnType<typeof bridge> & { emit: (e: string, p: unknown) => void };
    const hud = host.querySelector(".kxd-hud")!;
    renders = 0;
    for (let i = 0; i < 60; i++) {
      act(() => {
        b.emit("meeting:tick", { elapsed: 3600 + 125 + i });
      });
    }
    await act(frame);
    // Device test 0.6.2 ("HUD träge"): the tick used to re-render every context consumer.
    expect(renders).toBe(0);
    expect(hud.querySelector(".kxd-mb-time")?.textContent).toContain("1:03:");
    expect(clockStore.get()).toBeGreaterThanOrEqual(3600 + 125);
  });
});

