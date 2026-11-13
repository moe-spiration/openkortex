import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPackCover, packCoverFor } from "../src/theme/cover";
import { lifeTopic } from "../src/theme/lifeTopic";

const here = dirname(fileURLToPath(import.meta.url));
const media = resolve(here, "../../../packages/theme-packs/media");

describe("pack cover fallback", () => {
  it("maps entry types to the type tile topic", () => {
    expect(packCoverFor("article")).toEqual({ pack: "articles" });
    expect(packCoverFor("podcast")).toEqual({ pack: "video" });
    expect(packCoverFor("recipe")).toEqual({ pack: "recipes" });
    expect(packCoverFor("voice")).toEqual({ pack: "notes" });
    expect(packCoverFor("epub")).toEqual({ pack: "books" });
    expect(packCoverFor("person")).toEqual({ pack: "all" });
    expect(packCoverFor(undefined)).toEqual({ pack: "all" });
  });

  it("tells pack markers from image sources", () => {
    expect(isPackCover({ pack: "notes" })).toBe(true);
    expect(isPackCover({ uri: "https://x/c.jpg" })).toBe(false);
    expect(isPackCover(12)).toBe(false);
    expect(isPackCover([{ uri: "a" }])).toBe(false);
  });

  it("maps the six life areas", () => {
    expect(lifeTopic("health")).toBe("health");
    expect(lifeTopic("growth")).toBe("growth");
    expect(lifeTopic("overview")).toBeNull();
  });
});

describe("generated Android asset table", () => {
  const gen = readFileSync(join(here, "../src/theme/packAssets.gen.ts"), "utf8");
  const required = [...gen.matchAll(/require\("\.\.\/\.\.\/\.\.\/\.\.\/packages\/theme-packs\/media\/([^"]+)"\)/g)].map((m) => m[1]!);
  const manifest = JSON.parse(readFileSync(join(media, "manifest.json"), "utf8")) as { packs: Record<string, unknown> };

  const webp = new Set<string>();
  const walk = (o: unknown) => {
    if (o && typeof o === "object") {
      const r = o as { file?: string };
      if (typeof r.file === "string") {
        if (r.file.endsWith(".webp")) webp.add(r.file);
      } else Object.values(o).forEach(walk);
    }
  };
  walk(manifest.packs);

  it("requires every WebP of the manifest exactly once and nothing else", () => {
    expect(required.length).toBe(webp.size);
    expect(new Set(required)).toEqual(webp);
  });

  it("only requires files that exist, and no AVIF or SVG", () => {
    for (const f of required) {
      expect(existsSync(join(media, f)), f).toBe(true);
      expect(f.endsWith(".webp"), f).toBe(true);
    }
  });
});
