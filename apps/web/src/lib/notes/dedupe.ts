/*
 * Display dedupe (Tactile Craft v2, decision 4): the note header already shows the title and the AI summary, so the
 * reading view and the editor hide a leading `# Title` that matches the title and a leading TL;DR/summary paragraph.
 * Only the view changes. content_md, the vault file and imports keep both: the hidden text is kept verbatim and put
 * back in front of whatever the editor saves (joinDisplay), so `frontmatter + hidden + body` is always the stored text.
 */

export interface DisplayOptions {
  /** The note's title (header). */
  title: string;
  /** The note's summary (header), if any. */
  summary?: string | null;
}

export interface DisplaySplit {
  /** Leading YAML frontmatter block, verbatim ("" when there is none). */
  frontmatter: string;
  /** Text hidden from the view, verbatim: the matching H1 and/or the leading TL;DR paragraph with their blank lines. */
  hidden: string;
  /** What the reader and the editor show. */
  body: string;
  /** Which parts `hidden` holds. */
  hiddenTitle: boolean;
  hiddenSummary: boolean;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const H1 = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/;
const BLANK_LINES = /^(?:[ \t]*\r?\n)+/;
/** `**TL;DR:** …`, `**TL;DR**: …`, `**Zusammenfassung:** …`, `TL;DR: …` (also inside a blockquote). */
const SUMMARY_LABEL = /^(?:\*\*|__)?(?:tl;?dr|zusammenfassung|summary|kurzfassung|executive summary)(?::(?:\*\*|__)|(?:\*\*|__):?|:)\s*/i;

/** Comparable text: no Markdown emphasis or code marks, no trailing punctuation, single spaces, lower case. */
export function normalizeForCompare(s: string): string {
  return s
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?:;,\s]+$/, "")
    .toLowerCase();
}

/** Length of the first block (up to the next blank line or the end). */
function blockAt(text: string): string {
  const m = /\r?\n[ \t]*\r?\n/.exec(text);
  return m ? text.slice(0, m.index) : text;
}

function isSummaryBlock(block: string, summary: string | null | undefined): boolean {
  const lines = block.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return false;
  const quoted = lines.every((l) => /^\s*>/.test(l));
  const text = (quoted ? lines.map((l) => l.replace(/^\s*>\s?/, "")) : lines).join(" ").trim();
  // Never hide headings, lists, tables or code.
  if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||```|~~~)/.test(text)) return false;
  // A blockquote that is a callout (`> [!note]`) is content, not a summary.
  if (/^\[!/.test(text)) return false;
  if (SUMMARY_LABEL.test(text)) return true;
  const s = summary ? normalizeForCompare(summary) : "";
  return !!s && normalizeForCompare(text) === s;
}

/** Splits content_md into frontmatter, the hidden duplicate head and the visible body. */
export function splitForDisplay(md: string, opts: DisplayOptions): DisplaySplit {
  const fm = FRONTMATTER.exec(md)?.[0] ?? "";
  let rest = md.slice(fm.length);
  let hidden = "";
  let hiddenTitle = false;
  let hiddenSummary = false;

  const lead = BLANK_LINES.exec(rest)?.[0] ?? "";
  const afterLead = rest.slice(lead.length);
  const h1 = H1.exec(afterLead);
  const title = normalizeForCompare(opts.title);
  if (h1 && title && normalizeForCompare(h1[1]!) === title) {
    const gap = BLANK_LINES.exec(afterLead.slice(h1[0].length))?.[0] ?? "";
    hidden = lead + h1[0] + gap;
    rest = rest.slice(hidden.length);
    hiddenTitle = true;
  }

  // The summary counts as "leading" only when nothing visible stands before it (no H1, or the H1 was hidden).
  if (hiddenTitle || !h1) {
    const lead2 = BLANK_LINES.exec(rest)?.[0] ?? "";
    const block = blockAt(rest.slice(lead2.length));
    if (block && isSummaryBlock(block, opts.summary)) {
      const after = rest.slice(lead2.length + block.length);
      const gap = BLANK_LINES.exec(after.replace(/^\r?\n/, ""))?.[0] ?? "";
      const nl = /^\r?\n/.exec(after)?.[0] ?? "";
      const take = lead2 + block + nl + gap;
      hidden += take;
      rest = rest.slice(take.length);
      hiddenSummary = true;
    }
  }

  return { frontmatter: fm, hidden, body: rest, hiddenTitle, hiddenSummary };
}

/** Stored text for a body edited in the view: the frontmatter and the hidden head go back in front, unchanged. */
export function joinDisplay(split: Pick<DisplaySplit, "frontmatter" | "hidden">, body: string): string {
  if (!split.hidden) return split.frontmatter + body;
  // An emptied body must not glue anything to the hidden head; it already ends with its own line break(s).
  return split.frontmatter + split.hidden + body;
}

/**
 * Split that stays stable while the user edits: as long as the stored text still starts with the previous
 * frontmatter + hidden head, that head is kept and only the body follows the text (so typing a new first paragraph
 * never makes it vanish). When the head no longer matches (another device, an AI rewrite) it is split anew.
 */
export function rebaseDisplay(md: string, prev: DisplaySplit | null, opts: DisplayOptions): DisplaySplit {
  if (prev) {
    const head = prev.frontmatter + prev.hidden;
    if (md.startsWith(head)) return { ...prev, body: md.slice(head.length) };
  }
  return splitForDisplay(md, opts);
}
