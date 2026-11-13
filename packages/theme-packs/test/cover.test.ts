import { describe, expect, it } from "vitest";
import { coverTopicForType, parsePack, resolveCover, tileSources } from "../src";

const base = "/theme-packs";

describe("coverTopicForType", () => {
  it.each([
    ["article", "articles"],
    ["bookmark", "articles"],
    ["video", "video"],
    ["podcast", "video"],
    ["social", "video"],
    ["recipe", "recipes"],
    ["note", "notes"],
    ["voice", "notes"],
    ["meeting", "meetings"],
    ["pdf", "books"],
    ["epub", "books"],
    ["ai_chat", "ai"],
    ["digest", "all"],
    ["person", "all"],
    ["project", "all"],
    [undefined, "all"],
  ])("%s -> %s", (type, topic) => {
    expect(coverTopicForType(type)).toBe(topic);
  });
});

describe("resolveCover", () => {
  const common = { pack: "calm", mode: "dark", base } as const;
  it("prefers the own cover", () => {
    const r = resolveCover({ ...common, type: "article", own: "/mine.webp", extracted: "https://x/y.jpg" });
    expect(r).toEqual({ src: "/mine.webp", source: "own" });
  });
  it("then the extracted medium", () => {
    const r = resolveCover({ ...common, type: "article", own: " ", extracted: "https://x/y.jpg" });
    expect(r).toEqual({ src: "https://x/y.jpg", source: "extracted" });
  });
  it("then the type tile of the active pack", () => {
    const r = resolveCover({ ...common, type: "recipe" });
    expect(r.source).toBe("pack");
    expect(r.topic).toBe("recipes");
    expect(r.src).toBe(tileSources("calm", "dark", "recipes", base).src);
    expect(r.src).toMatch(/^\/theme-packs\/calm\/dark\/recipes-tile\.svg\?v=[0-9a-f]{12}$/);
  });
  it("uses the AVIF tile of the foto pack", () => {
    expect(tileSources("foto", "light", "notes", base).src).toMatch(/foto\/light\/notes-tile\.avif/);
  });
});

describe("parsePack", () => {
  it("falls back to calm", () => {
    expect(parsePack("origami")).toBe("origami");
    expect(parsePack("nope")).toBe("calm");
    expect(parsePack(null)).toBe("calm");
  });
});
