import { describe, expect, it } from "vitest";
import { LOOK_KEY, THEME_KEY, applyLook, applyTheme, parseLook, parseTheme, readLook, readTheme, resolveTheme } from "@/theme";

describe("desktop look (Ruhe switch)", () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === LOOK_KEY ? v : null) });

  it("defaults to ruhe and only accepts the two looks", () => {
    expect(parseLook(null)).toBe("ruhe");
    expect(parseLook("fancy")).toBe("ruhe");
    expect(parseLook("classic")).toBe("ruhe");
    expect(parseLook("vivid")).toBe("vivid");
    expect(readLook(null, null)).toBe("ruhe");
    expect(readLook(null, store("vivid"))).toBe("vivid");
  });

  it("?look= wins over the stored look, a broken storage falls back to ruhe", () => {
    expect(readLook("vivid", store("ruhe"))).toBe("vivid");
    expect(readLook("ruhe", store(null))).toBe("ruhe");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLook(null, broken)).toBe("ruhe");
  });

  it("sets data-look on the root", () => {
    const el = document.createElement("html");
    applyLook(el, "vivid");
    expect(el.dataset.look).toBe("vivid");
  });
});

describe("desktop light / dark (Ruhe D5)", () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === THEME_KEY ? v : null) });

  it("follows Windows unless light or dark was chosen; ?theme= wins", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("sepia")).toBe("system");
    expect(readTheme(null, null)).toBe("system");
    expect(readTheme(null, store("light"))).toBe("light");
    expect(readTheme("dark", store("light"))).toBe("dark");
    const broken = { getItem: () => { throw new Error("blocked"); } };
    expect(readTheme(null, broken)).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("sets data-theme and the colour scheme of the form controls", () => {
    const el = document.createElement("html");
    applyTheme(el, "light");
    expect(el.dataset.theme).toBe("light");
    expect(el.style.colorScheme).toBe("light");
  });
});
