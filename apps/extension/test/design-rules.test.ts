import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Board 11 / DESIGN.md section 5, enforced for the extension UI so they cannot drift back:
// mono only for URLs (E/H), tag colours only as a dot (E), three radii (F), no serif (01d).

const SRC = resolve(process.cwd(), "src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const all = files(SRC).map((p) => ({ path: relative(SRC, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));
const tsx = all.filter((f) => /\.tsx$/.test(f.path));
const css = all.find((f) => f.path === "styles/ext.css")!.text;

const offenders = (list: typeof all, re: RegExp) =>
  list.flatMap((f) => (re.test(f.text) ? [f.path] : []));

describe("extension design rules", () => {
  it("uses mono only for URLs (the .kx-domain line and URL inputs)", () => {
    expect(offenders(tsx, /font-mono|var\(--font-mono\)|kx-t-path/)).toEqual([]);
    const uses = [...css.matchAll(/^([^{}\n]+)\{[^}]*var\(--font-mono\)[^}]*\}/gm)].map((m) => m[1]!.trim());
    // the token definition and the two URL helpers are the only places that name the mono font
    expect(uses.filter((s) => !/^(:root|\.kx-domain|\.kx-url)/.test(s))).toEqual([]);
  });

  it("never fills or outlines UI with tag colours (only the dot carries them)", () => {
    expect(offenders(tsx, /\b(text|bg|border)-tag-|var\(--tag-[a-z]+-(fg|bg|border)\)|<HashtagPill[^>]*\sdomain=/)).toEqual([]);
    expect(offenders(tsx, /variant="chip"/)).toEqual([]);
    const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(cssRules).not.toMatch(/var\(--tag-[a-z]+-(fg|bg|border)\)/);
  });

  it("sticks to the three radii: 8 controls, 12 rows, 16 cards (pills only for chips)", () => {
    expect(offenders(tsx, /rounded-(sm|md|xl|2xl|3xl)\b|rounded-\[/)).toEqual([]);
    const px = [...css.matchAll(/border-radius:\s*(\d+)px/g)].map((m) => Number(m[1]));
    // the only literal pixel radii are tiny details (progress bar 2, switch/radio handles); no ad-hoc 6, 10, 14
    expect(px.filter((n) => ![2, 3, 5].includes(n))).toEqual([]);
  });

  it("has no serif and no raw hex colours outside the white switch handle", () => {
    expect(offenders(all, /Instrument|font-serif/)).toEqual([]);
    expect(offenders(tsx, /font-display/)).toEqual([]);
    const hex = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toUpperCase());
    expect(hex.filter((h) => h !== "#FFFFFF")).toEqual([]);
  });

  it("keeps accent colour for actions: no accent-tinted fills in the shipped UI", () => {
    expect(offenders(tsx, /bg-ai-soft|bg-tag-ai|text-tag-ai|shadow-\[[^\]]*accent/)).toEqual([]);
  });
});
