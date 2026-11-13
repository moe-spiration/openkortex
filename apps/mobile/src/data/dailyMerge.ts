// keep in sync with apps/web/src/lib/daily/merge.ts
/*
 * Daily note `10_Notes/Daily/<date>.md` (W-01): the check-in owns only its own parts of the file, the
 * frontmatter keys it writes, the `# Daily Journal <date>` title and its sections (heading plus list lines).
 * Every other line (free text, own sections, own frontmatter keys) is the user's and survives every save,
 * so a habit click on Home never wipes what was written into the note in the editor or in Obsidian.
 */

/** H2 sections written by the check-in (`toDailyMarkdown`). */
export const DAILY_SECTIONS = ["Check-in", "Top-3-Prioritäten", "Mind Dump", "Voice Check-ins"] as const;

const MANAGED = new Set<string>(DAILY_SECTIONS.map((s) => s.toLowerCase()));
const H1 = /^#\s+Daily Journal\b/i;
const H2 = /^##\s+(.+?)\s*#*\s*$/;
const HEADING = /^#{1,6}\s/;
const LIST_LINE = /^\s*- /;

function splitFm(md: string): { fm: string[] | null; body: string[] } {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) return { fm: lines.slice(1, end), body: lines.slice(end + 1) };
  }
  return { fm: null, body: lines };
}

/** Top-level YAML keys with their indented continuation lines. */
function fmEntries(fm: readonly string[]): { key: string | null; lines: string[] }[] {
  const out: { key: string | null; lines: string[] }[] = [];
  for (const l of fm) {
    const m = /^([A-Za-z0-9_-]+)\s*:/.exec(l);
    if (m || !out.length) out.push({ key: m?.[1] ?? null, lines: [l] });
    else out.at(-1)!.lines.push(l);
  }
  return out;
}

function trim(lines: readonly string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a]!.trim()) a++;
  while (b > a && !lines[b - 1]!.trim()) b--;
  return lines.slice(a, b);
}

/**
 * Writes the check-in (`generated`, from `toDailyMarkdown`) into the stored note, in place: its frontmatter
 * keys win and the user's other keys stay; the title is replaced; the check-in sections are swapped for the
 * new ones where they were. Every other line stays where the user put it.
 */
export function mergeDailyMarkdown(existing: string | null | undefined, generated: string): string {
  if (!existing?.trim()) return generated;
  const gen = splitFm(generated);
  const cur = splitFm(existing);
  const genEntries = fmEntries(gen.fm ?? []);
  const genKeys = new Set(genEntries.map((e) => e.key));
  const extra = fmEntries(cur.fm ?? []).filter((e) => e.key && !genKeys.has(e.key));
  const fm = [...genEntries.flatMap((e) => e.lines), ...extra.flatMap((e) => e.lines)];

  const genBody = trim(gen.body);
  const genH1 = genBody[0] && H1.test(genBody[0]) ? genBody[0] : null;
  const genSections = trim(genH1 ? genBody.slice(1) : genBody);

  const out: string[] = [];
  let h1At = -1;
  let inserted = false;
  let skipping = false;
  for (const l of cur.body) {
    if (H1.test(l)) {
      skipping = false;
      if (h1At < 0 && genH1) {
        h1At = out.length;
        out.push(genH1);
      }
      continue;
    }
    const h2 = H2.exec(l);
    if (h2 && MANAGED.has(h2[1]!.trim().toLowerCase())) {
      if (!inserted) out.push(...genSections, "");
      inserted = true;
      skipping = true;
      continue;
    }
    // A check-in section is its list lines; any other line belongs to the user again.
    if (skipping && (!l.trim() || LIST_LINE.test(l))) continue;
    skipping = false;
    out.push(l);
  }
  if (genH1 && h1At < 0) {
    out.unshift(genH1, "");
    h1At = 0;
  }
  if (!inserted) {
    // No check-in yet: below the title and the text directly under it, before the first section.
    let at = h1At + 1;
    while (at < out.length && !HEADING.test(out[at]!)) at++;
    const gap = out[at - 1]?.trim() ? [""] : [];
    out.splice(at, 0, ...gap, ...genSections, "");
  }
  // At most one blank line in a row.
  const body = trim(out).filter((l, i, a) => l.trim() !== "" || (a[i - 1] ?? "").trim() !== "");
  return [...(gen.fm ? ["---", ...fm, "---"] : []), ...body, ""].join("\n");
}
