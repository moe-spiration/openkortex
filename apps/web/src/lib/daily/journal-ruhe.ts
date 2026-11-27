/*
 * Tagebuch in the Ruhe look (2026-11-27): the day's entry shown as two labelled fields and the energy as 1 to 5.
 * Nothing new is stored: both fields stay lines of the daily note's "## Mind Dump" (an answer to "Wofür bin ich
 * dankbar?" is a line that starts with the question, the same line the earlier prompt chips wrote), and the energy
 * stays the 1..10 value of the check-in (a level n is saved as 2n; an older 7 shows as 4).
 */

/** The gratitude question as a line prefix, in both languages (stored text is read in both). */
export const GRATEFUL_PREFIXES = ["Wofür bin ich dankbar?", "What am I grateful for?"] as const;

const prefixOf = (line: string) => GRATEFUL_PREFIXES.find((p) => line.trimStart().toLowerCase().startsWith(p.toLowerCase()));

/** Splits the entry text into the free part ("Was war heute wichtig?") and the gratitude answers. */
export function splitEntry(text: string): { important: string; grateful: string } {
  const important: string[] = [];
  const grateful: string[] = [];
  for (const line of text.split("\n")) {
    const p = prefixOf(line);
    if (p) grateful.push(line.trimStart().slice(p.length).trim());
    else important.push(line);
  }
  while (important.length && !important[important.length - 1]!.trim()) important.pop();
  return { important: important.join("\n"), grateful: grateful.join("\n") };
}

/** Joins the two fields back into the entry text; every gratitude line carries the question in front. */
export function joinEntry(important: string, grateful: string, prefix: string): string {
  const g = grateful.split("\n").map((l) => `${prefix} ${l.trim()}`.trimEnd());
  const head = important.replace(/\s+$/, "");
  if (!grateful.length) return head;
  return head ? `${head}\n${g.join("\n")}` : g.join("\n");
}

/** Energy 1..10 of the check-in as the level 1..5 the Ruhe journal shows (null stays null). */
export const energyLevel = (energy: number | null | undefined): number | null => (typeof energy === "number" && energy >= 1 ? Math.min(5, Math.ceil(energy / 2)) : null);

/** The 1..10 value stored for a picked level 1..5. */
export const energyOfLevel = (level: number): number => Math.max(1, Math.min(10, Math.round(level) * 2));
