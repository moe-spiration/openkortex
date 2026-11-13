/*
 * Exact search-and-replace on Markdown (pure; server and client). Used by the copilot's note_edit
 * tool and by the notes store when it replays a server edit on a note with unsaved typing.
 */

export interface ReplacementSpec {
  find: string;
  replace: string;
  /** Only whole words (default true); applies at the ends of `find` that are word characters. */
  whole_word?: boolean;
  /** Default true. */
  case_sensitive?: boolean;
}

export interface ReplacementResult {
  find: string;
  replace: string;
  count: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD = /[\p{L}\p{N}_]/u;

/** Applies the replacements in order; "Dr. Mayer" or "Mayer," still match with whole_word. */
export function applyReplacements(
  md: string,
  replacements: readonly ReplacementSpec[],
): { content: string; results: ReplacementResult[] } {
  let content = md;
  const results: ReplacementResult[] = [];
  for (const r of replacements) {
    if (!r.find) continue;
    const whole = r.whole_word ?? true;
    const head = whole && WORD.test(r.find[0] ?? "") ? "(?<![\\p{L}\\p{N}_])" : "";
    const tail = whole && WORD.test(r.find.at(-1) ?? "") ? "(?![\\p{L}\\p{N}_])" : "";
    const flags = `gu${r.case_sensitive === false ? "i" : ""}`;
    const re = new RegExp(`${head}${escapeRe(r.find)}${tail}`, flags);
    let count = 0;
    content = content.replace(re, () => {
      count++;
      return r.replace;
    });
    results.push({ find: r.find, replace: r.replace, count });
  }
  return { content, results };
}
