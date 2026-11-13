import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("generated manifest module", () => {
  it("is up to date with media/manifest.json", () => {
    const file = join(root, "src", "manifest.gen.ts");
    const before = readFileSync(file, "utf8");
    execFileSync(process.execPath, [join(root, "scripts", "gen-manifest.mjs")], { stdio: "pipe" });
    const after = readFileSync(file, "utf8");
    expect(after === before).toBe(true);
  });
});
