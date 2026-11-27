import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it } from "vitest";
import { bridge, setBridgeForTests } from "@/bridge";
import { createMockBridge } from "@/bridge/mock";
import { DesktopProvider } from "@/state/desktop";
import { MeetingBar } from "@/windows/MeetingBar";

/*
 * Ruhe D2: HUD and pill are one part. Collapsed it is the bar (no transcript), expanded the panel shows one coaching
 * card with its title, the chips (tasks, the object's file) and the stealth state. The clock runs at one tick per
 * hour (no demo lines inside the test).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
const q = (sel: string) => host.querySelector<HTMLElement>(sel);

describe("meeting bar", () => {
  it("collapses to the bar and expands to one card with chips", async () => {
    await act(async () => {
      root.render(
        <DesktopProvider initialMode="pill">
          <MeetingBar />
        </DesktopProvider>,
      );
      await frame();
    });
    for (let i = 0; i < 250 && q(".kxd-hud")?.getAttribute("data-phase") !== "live"; i++) await act(frame);
    expect(q(".kxd-hud")?.getAttribute("data-mode")).toBe("pill");
    expect(q(".kxd-mb-panel")).toBeNull();
    expect(q(".kxd-mb-end")).not.toBeNull();

    await act(async () => q('[data-hud-action="hud"]')!.click());
    expect(q(".kxd-mb-panel")).not.toBeNull();

    const b = bridge() as ReturnType<typeof bridge> & { emit: (e: string, p: unknown) => void };
    await act(async () => {
      b.emit("coaching:cards", {
        cards: [
          { kind: "question", text: "Ask about conflicts.", title: "Good moment now", object: { id: "00000000-0000-4000-8000-0000000000aa", title: "Tom Berger", type: "person" } },
          { kind: "action", text: "Send the pricing." },
          // An older core sends no title and no object: the card falls back to its kind.
          { kind: "fact", text: "Q3 had 12 % churn." },
        ],
      });
      await frame();
    });
    // One card at a time, its own title first.
    expect(host.querySelectorAll(".kxd-hud-tip")).toHaveLength(1);
    expect(q(".kxd-mb-cardtitle")?.textContent).toBe("Good moment now");
    expect(q(".kxd-mb-pager")?.textContent).toContain("1 / 3");
    const chips = Array.from(host.querySelectorAll(".kxd-mb-chip")).map((c) => c.textContent);
    expect(chips).toEqual(["1 Aufgabe erkannt", "Akte Tom"]);
    expect(q(".kxd-mb-stealth")?.textContent).toBe("Nur für Dich sichtbar");

    await act(async () => q(".kxd-mb-pager")!.click());
    await act(async () => q(".kxd-mb-pager")!.click());
    expect(q(".kxd-mb-cardtitle")?.textContent).toBe("Fakten-Check");

    await act(async () => q('[data-hud-action="pill"]')!.click());
    expect(q(".kxd-mb-panel")).toBeNull();
  });
});
