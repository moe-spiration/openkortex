import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * An icon name the Icon set does not have used to crash the app when it was drawn (0.6.3: long-press
 * on a task in the Inbox, its menu asked for "edit"). Every literal icon name in the sources must exist.
 */

const SRC = join(__dirname, "..", "src");
const iconSrc = readFileSync(join(SRC, "ui", "Icon.tsx"), "utf8");
const block = iconSrc.slice(iconSrc.indexOf("const ICONS = {"));
const known = new Set([...block.slice(0, block.indexOf("\n};")).matchAll(/^ {2}"?([a-zA-Z-]+)"?:/gm)].map((m) => m[1]));

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

describe("icon names", () => {
  it("finds the icon set", () => {
    expect(known.size).toBeGreaterThan(20);
  });

  it("uses only icons the set has", () => {
    const missing: string[] = [];
    for (const f of files(SRC)) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/\bicon(?:Name)?: "([a-zA-Z-]+)"|<Icon name="([a-zA-Z-]+)"/g)) {
        const name = m[1] ?? m[2]!;
        if (!known.has(name)) missing.push(`${f.slice(SRC.length + 1)}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
