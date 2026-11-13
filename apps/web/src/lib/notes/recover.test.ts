// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/workspace-data", () => ({ isLiveData: () => true }));

const { useRefreshWhenMissing } = await import("./recover");

let root: Root;
let looking: boolean[] = [];
function Probe({ id, missing }: { id: string; missing: boolean }) {
  looking.push(useRefreshWhenMissing(id, missing));
  return null;
}
const render = (id: string, missing: boolean) => act(() => root.render(createElement(Probe, { id, missing })));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  refresh.mockClear();
  looking = [];
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.useRealTimers();
});

describe("useRefreshWhenMissing", () => {
  it("refreshes at once, then twice more, and gives up after a grace period", async () => {
    await render("n1", true);
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1500);
    expect(refresh).toHaveBeenCalledTimes(2);
    await advance(4000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(looking.at(-1)).toBe(true);
    await advance(4000);
    expect(looking.at(-1)).toBe(false); // "Notiz nicht gefunden."
    await advance(20_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("stops as soon as the note arrives", async () => {
    await render("n1", true);
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await render("n1", false);
    expect(looking.at(-1)).toBe(false);
    await advance(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("starts over for another note", async () => {
    await render("n1", true);
    for (const ms of [0, 1500, 4000, 4000]) await advance(ms);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(looking.at(-1)).toBe(false);
    await render("n2", true);
    expect(looking.at(-1)).toBe(true);
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(4);
  });
});
