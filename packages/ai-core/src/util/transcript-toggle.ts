/*
 * Transcripts sit at the very bottom of a note as a folded editor toggle (Obsidian fold callout,
 * see packages/ui/src/editor/README.md): `> [!toggle]- Transkript`, body quoted line by line.
 * `<details>` is not used: the editor shows it as raw HTML. The body starts after an empty `>` line
 * so a heading or table never continues the title.
 */

import { ph } from "../i18n";

/** German title (the original). `transcriptTitle()` is the title in the user's language. */
export const TRANSCRIPT_TITLE = "Transkript";
export const transcriptTitle = (): string => ph("transcript");

/** Quotes every line of `body` (blank lines become a bare `>`), as the body of a toggle. */
export function quoteLines(lines: readonly string[]): string[] {
  return lines.flatMap((l) => l.split(/\r?\n/)).map((l) => (l.trim() ? `> ${l}` : ">"));
}

/** Markdown lines of a folded transcript toggle; empty array when there is no text. */
export function transcriptToggleLines(
  body: string | readonly string[],
  title: string = transcriptTitle(),
): string[] {
  const lines = typeof body === "string" ? body.trim().split(/\r?\n/) : [...body];
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  if (!lines.length) return [];
  return [`> [!toggle]- ${title}`, ">", ...quoteLines(lines)];
}
