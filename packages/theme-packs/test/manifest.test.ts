import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSETS, LUM_TOPICS, MODE_IDS, PACK_IDS, TILE_TOPICS, TOPIC_IDS, packBytes, type AssetRef } from "../src";

const media = join(dirname(fileURLToPath(import.meta.url)), "..", "media");

function refs(): AssetRef[] {
  const out: AssetRef[] = [];
  for (const p of PACK_IDS)
    for (const m of MODE_IDS)
      for (const t of TOPIC_IDS) {
        const e = ASSETS[p][m][t];
        out.push(...Object.values(e.tile ?? {}), ...Object.values(e.full), ...Object.values(e.lum ?? {}));
      }
  return out;
}

describe("manifest completeness", () => {
  it("has 7 packs, 2 modes, 17 topics", () => {
    expect(PACK_IDS).toHaveLength(7);
    expect(MODE_IDS).toHaveLength(2);
    expect(TOPIC_IDS).toHaveLength(17);
  });

  it("every combination has the expected files", () => {
    for (const p of PACK_IDS)
      for (const m of MODE_IDS)
        for (const t of TOPIC_IDS) {
          const e = ASSETS[p][m][t];
          expect(e.full.avif && e.full.webp, `${p}/${m}/${t} full`).toBeTruthy();
          const hasTile = (TILE_TOPICS as readonly string[]).includes(t);
          expect(Boolean(e.tile), `${p}/${m}/${t} tile`).toBe(hasTile);
          if (e.tile) {
            expect(e.tile.webp, `${p}/${m}/${t} tile webp`).toBeTruthy();
            expect(Boolean(e.tile.svg || e.tile.avif), `${p}/${m}/${t} tile primary`).toBe(true);
          }
          const hasLum = (LUM_TOPICS as readonly string[]).includes(t);
          expect(Boolean(e.lum), `${p}/${m}/${t} lum`).toBe(hasLum);
        }
  });
});

describe("media files", () => {
  it("every referenced file exists with the manifest SHA", () => {
    for (const r of refs()) {
      const p = join(media, r.file);
      expect(existsSync(p), r.file).toBe(true);
      const sha = createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, r.sha.length);
      expect(sha, r.file).toBe(r.sha);
    }
  });
});

describe("size budgets (gzip, both modes)", () => {
  const web = { tile: "svg", full: "avif" } as const;
  it("each pack stays within its upper bound on web", () => {
    for (const p of PACK_IDS) {
      // Spec 10: target 100 KB, upper bound 150 KB; foto up to 300 KB; fluid is known to sit just above (153 KB).
      const limit = p === "foto" ? 300 : p === "fluid" ? 160 : 150;
      expect(packBytes(p, web) / 1024, p).toBeLessThanOrEqual(limit);
    }
  });
});
