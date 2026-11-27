import { describe, expect, it } from "vitest";
import { hexHue, oklchToHex, RUHE_ACCENT_C, RUHE_ACCENT_L } from "./oklch";

describe("oklch helpers (Ruhe accent slider)", () => {
  it("writes a valid hex and reads its hue back", () => {
    for (const h of [0, 45, 155, 230, 276, 320]) {
      const hex = oklchToHex(RUHE_ACCENT_L, RUHE_ACCENT_C, h);
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
      const back = hexHue(hex)!;
      const d = Math.min(Math.abs(back - h), 360 - Math.abs(back - h));
      expect(d).toBeLessThanOrEqual(2);
    }
  });

  it("matches the mockup accent (oklch 0.63 0.155 276 is an indigo)", () => {
    const hex = oklchToHex(0.63, 0.155, 276);
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("answers null for greys and invalid values", () => {
    expect(hexHue("#808080")).toBeNull();
    expect(hexHue("nope")).toBeNull();
  });
});
