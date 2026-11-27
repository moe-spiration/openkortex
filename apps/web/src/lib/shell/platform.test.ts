// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PLATFORM_SCRIPT, isWindowsUA } from "./platform";

describe("platform mark (Ruhe weights on Windows)", () => {
  it("recognises Windows user agents, including WebView2", () => {
    expect(isWindowsUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0")).toBe(true);
    expect(isWindowsUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15")).toBe(false);
    expect(isWindowsUA("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")).toBe(false);
  });

  it("the pre-paint script marks <html> only on Windows", () => {
    const root = document.documentElement;
    delete root.dataset.os;
    new Function(PLATFORM_SCRIPT)();
    expect(root.dataset.os).toBe(isWindowsUA(navigator.userAgent) ? "windows" : undefined);
  });
});
