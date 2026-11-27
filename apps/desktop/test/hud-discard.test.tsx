import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it } from "vitest";
import { DesktopProvider } from "@/state/desktop";
import { MeetingBar } from "@/windows/MeetingBar";

/*
 * 0.6.5 (user request): besides "end call" the HUD offers "discard". It asks once in place, then throws the
 * recording away (discard_recording) and goes back to "ready". Since 0.6.8 (Ruhe meeting bar) "Beenden" is the
 * one red action on the bar and "discard" a quiet icon in the panel head; the question replaces the footer.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
afterAll(() => act(() => root.unmount()));

const frame = () => new Promise((r) => setTimeout(r, 20));
const q = (sel: string) => host.querySelector<HTMLElement>(sel);

describe("HUD discard", () => {
  it("asks first, can be cancelled, then discards and is ready again", async () => {
    await act(async () => {
      root.render(
        <DesktopProvider initialMode="hud">
          <MeetingBar />
        </DesktopProvider>,
      );
      await frame();
    });
    expect(q(".kxd-hud")?.getAttribute("data-phase")).toBe("live");
    // "End" on the bar, "discard" in the panel; nothing is discarded by the first click.
    expect(q(".kxd-mb-end")).not.toBeNull();
    await act(async () => q('[data-hud-action="ask-discard"]')!.click());
    expect(q(".kxd-mb-confirm")).not.toBeNull();
    expect(q(".kxd-hud")?.getAttribute("data-phase")).toBe("live");

    // "Keep recording" folds the question back.
    await act(async () => q('.kxd-mb-confirm [data-hud-action="keep"]')!.click());
    expect(q(".kxd-mb-confirm")).toBeNull();
    expect(q(".kxd-hud")?.getAttribute("data-phase")).toBe("live");

    await act(async () => q('[data-hud-action="ask-discard"]')!.click());
    await act(async () => {
      q('[data-hud-action="discard"]')!.click();
      await frame();
    });
    expect(q(".kxd-hud")?.getAttribute("data-phase")).toBe("idle");
    expect(q(".kxd-mb-end")).toBeNull();
  });
});
