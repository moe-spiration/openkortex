import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const ROOT = join(__dirname, "..");
const plugin = require("../plugins/with-quick-capture.js") as { javaSource: (pkg: string) => string };

describe("quick overlay (native side)", () => {
  it("app.json loads the plugin", () => {
    const app = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8")) as { expo: { plugins: unknown[] } };
    expect(app.expo.plugins).toContain("./plugins/with-quick-capture");
  });

  it("the activity renders the JS root registered in index.ts and passes the kind from the link", () => {
    const java = plugin.javaSource("io.github.moe_spiration.openkortex");
    expect(java).toContain("package io.github.moe_spiration.openkortex;");
    expect(java).toContain('return "KortexQuick";');
    expect(java).toContain('getQueryParameter("kind")');
    expect(readFileSync(join(ROOT, "index.ts"), "utf8")).toContain('registerComponent("KortexQuick"');
  });
});
