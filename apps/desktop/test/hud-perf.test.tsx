import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it } from "vitest";
import { bridge } from "@/bridge";
import { DEMO_LINES } from "@/bridge/mock";
import { DesktopProvider, useDesktop } from "@/state/desktop";
import { clockStore } from "@/state/clock";
import { levelStore } from "@/state/levels";
import { Hud } from "@/windows/Hud";

/*
 * fx3 (device test 0.6.1, "HUD wirkt hakelig"): level events (~30/s) must not re-render React.
 * The meters read the level store and write the DOM directly; React only renders on real state
 * changes (transcript, coaching, clock). Numbers for the hand-over: `KX_PERF=1 pnpm vitest run hud-perf`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
afterAll(() => act(() => root.unmount()));

const frame = () => new Promise((r) => setTimeout(r, 20));

let renders = 0;
/** The HUD plus a render counter (every context consumer renders when the provider does). */
function CountedHud() {
  useDesktop();
  renders += 1;
  return <Hud />;
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
    expect(hud.getAttribute("data-phase")).toBe("live");
    // The mock bridge opens on a running conversation: 60 ms after it is created it sends the first
    // transcript lines, a real state change that renders. Wait for them before counting, otherwise a
    // slow runner counts that render as one caused by the level events.
    const intro = DEMO_LINES[1]!.text;
    for (let i = 0; i < 100 && !hud.textContent?.includes(intro); i++) await act(frame);
    expect(hud.textContent).toContain(intro);

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
    // The latest level reached the DOM: dB readout and the microphone attribute for the self-test probe
    // (the mock bridge keeps sending its own levels, so compare with the store).
    // The DOM must show a level the store actually held (the mock may send one between the read and
    // the next animation frame, which made an exact comparison flaky).
    const seen = new Set<string>();
    const off = levelStore.subscribe((l) => seen.add(String(Math.round(l.a))));
    await act(frame);
    off();
    const shown = hud.getAttribute("data-mic-db")!;
    expect(seen.has(shown) || shown === String(levelStore.get().a)).toBe(true);
    expect(hud.textContent).toContain(`${shown} dB`);
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
    expect(hud.textContent).toContain(`REC ${"1:03:"}`);
    expect(clockStore.get()).toBeGreaterThanOrEqual(3600 + 125);
  });
});

