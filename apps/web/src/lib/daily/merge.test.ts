import { describe, expect, it } from "vitest";
import { mergeDailyMarkdown } from "./merge";

const gen = (energy: number, habit: boolean) =>
  [
    "---",
    "type: daily",
    "date: 2026-11-03",
    `energy: ${energy}`,
    "streak: 3",
    "habits:",
    `  mob: ${habit}`,
    "focus_done: 0",
    "tags: [daily]",
    "---",
    "# Daily Journal 2026-11-03",
    "",
    "## Check-in",
    `- Energie: ${energy}/10`,
    `- ${habit ? "[x]" : "[ ]"} Morning Mobility`,
    "",
    "## Top-3-Prioritäten",
    "- [ ] Folien",
    "",
  ].join("\n");

describe("mergeDailyMarkdown (W-01: a check-in save never wipes the user's text)", () => {
  it("a new note is the generated check-in", () => {
    expect(mergeDailyMarkdown(null, gen(7, false))).toBe(gen(7, false));
    expect(mergeDailyMarkdown("", gen(7, false))).toBe(gen(7, false));
  });

  it("an unchanged note with only the check-in is rewritten byte for byte", () => {
    expect(mergeDailyMarkdown(gen(7, false), gen(7, false))).toBe(gen(7, false));
  });

  it("replaces the check-in parts and keeps free text, own sections and own frontmatter keys", () => {
    const stored = gen(7, false)
      .replace("tags: [daily]\n", "tags: [daily]\nmood: ruhig\n")
      .replace("# Daily Journal 2026-11-03\n", "# Daily Journal 2026-11-03\n\nHeute früh lange über [[Projekt X]] nachgedacht.\n")
      .concat("\n## Abendnotiz\n\nGuter Tag, *wichtig*: Anruf bei Anna.\n\n- [ ] eigene Aufgabe\n");
    const out = mergeDailyMarkdown(stored, gen(9, true));
    expect(out).toContain("energy: 9");
    expect(out).toContain("  mob: true");
    expect(out).toContain("mood: ruhig");
    expect(out).toContain("- [x] Morning Mobility");
    expect(out).not.toContain("- [ ] Morning Mobility");
    expect(out).toContain("# Daily Journal 2026-11-03\n\nHeute früh lange über [[Projekt X]] nachgedacht.\n\n## Check-in");
    expect(out).toContain("## Abendnotiz\n\nGuter Tag, *wichtig*: Anruf bei Anna.\n\n- [ ] eigene Aufgabe");
    expect(out.match(/## Check-in/g)).toHaveLength(1);
    expect(out.match(/# Daily Journal/g)).toHaveLength(1);
    // Stable: saving the same check-in again changes nothing.
    expect(mergeDailyMarkdown(out, gen(9, true))).toBe(out);
  });

  it("a paragraph written right below a check-in list stays (only list lines belong to the section)", () => {
    const stored = gen(7, false) + "Notiz direkt unter den Prioritäten.\n";
    const out = mergeDailyMarkdown(stored, gen(8, false));
    expect(out).toContain("Notiz direkt unter den Prioritäten.");
    expect(mergeDailyMarkdown(out, gen(8, false))).toBe(out);
  });

  it("a note without frontmatter (written elsewhere) keeps its text, the check-in follows it", () => {
    const out = mergeDailyMarkdown("Nur ein Gedanke.\n", gen(5, false));
    expect(out.startsWith("---\ntype: daily")).toBe(true);
    expect(out).toContain("# Daily Journal 2026-11-03\n\nNur ein Gedanke.\n\n## Check-in");
    expect(mergeDailyMarkdown(out, gen(5, false))).toBe(out);
  });
});
