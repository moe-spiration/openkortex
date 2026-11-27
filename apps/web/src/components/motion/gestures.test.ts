// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { gestureIcons, hasGesture } from "./gestures";
import { playGesture } from "./GestureLayer";

const html = (s: string) => {
  const d = document.createElement("div");
  d.innerHTML = s;
  document.body.append(d);
  return d.firstElementChild as HTMLElement;
};
afterEach(() => {
  document.body.innerHTML = "";
  delete document.documentElement.dataset.look;
});

describe("icon gestures on the action", () => {
  it("knows gesture icons by Ico id and by Lucide class", () => {
    expect(hasGesture(html('<svg data-ico="star"></svg>'))).toBe(true);
    expect(hasGesture(html('<svg class="lucide lucide-bell kx-ico"></svg>'))).toBe(true);
    expect(hasGesture(html('<svg class="lucide lucide-bell-off"></svg>'))).toBe(false);
    expect(hasGesture(html('<svg data-ico="folder"></svg>'))).toBe(false);
  });

  it("finds the icons of a control up to three levels deep, like the hover rule", () => {
    const b = html('<button><svg data-ico="archive"></svg><span><svg class="lucide lucide-star"></svg><b><svg data-ico="send"></svg><i><svg data-ico="sync"></svg></i></b></span></button>');
    expect(gestureIcons(b).map((s) => s.getAttribute("data-ico") ?? "star")).toEqual(["archive", "star", "send"]);
  });

  it("marks the icons as playing in the Ruhe look only", () => {
    const b = html('<button><svg data-ico="star"></svg></button>');
    playGesture(b);
    expect(b.querySelector("svg")!.classList.contains("kx-gesture-play")).toBe(false);
    document.documentElement.dataset.look = "ruhe";
    playGesture(b);
    expect(b.querySelector("svg")!.classList.contains("kx-gesture-play")).toBe(true);
  });
});
