/*
 * Whitespace-normalised text index over a DOM subtree (pdf.js text layer or an EPUB section).
 * Maps every character of the normalised text back to a DOM position, so a selection becomes a
 * stable quote and a stored quote becomes a Range again. Both formats share the same text, which
 * lets a highlight made in the PDF show up in the EPUB and vice versa.
 */

interface Pos {
  node: Text;
  offset: number;
  /** Space inserted between two separate text runs (lines, blocks); no DOM character behind it. */
  virtual: boolean;
}

export interface TextIndex {
  text: string;
  pos: Pos[];
}

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,div,section";

/**
 * @param runOf element that separates text runs: different runs are joined with a space
 *   (pdf.js: one span per line; EPUB: the enclosing block).
 */
export function buildIndex(root: Element, runOf: (t: Text) => Element | null = blockOf): TextIndex {
  const pos: Pos[] = [];
  let text = "";
  let prevRun: Element | null = null;
  let last: Text | null = null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const data = n.data;
    if (!data) continue;
    const run = runOf(n);
    if (last && run !== prevRun && text && !text.endsWith(" ")) {
      text += " ";
      pos.push({ node: last, offset: last.data.length, virtual: true });
    }
    for (let i = 0; i < data.length; i++) {
      const ch = /\s/.test(data[i] ?? "") ? " " : (data[i] ?? "");
      if (ch === " " && (text === "" || text.endsWith(" "))) continue;
      text += ch;
      pos.push({ node: n, offset: i, virtual: false });
    }
    prevRun = run;
    last = n;
  }
  return { text, pos };
}

export function blockOf(t: Text): Element | null {
  return t.parentElement?.closest(BLOCKS) ?? t.parentElement ?? null;
}

export const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/** The normalised text covered by `range` (characters fully inside it). */
export function textInRange(index: TextIndex, range: Range): string {
  let first = -1;
  let lastIdx = -1;
  index.pos.forEach((p, i) => {
    if (p.virtual) return;
    try {
      if (range.comparePoint(p.node, p.offset) >= 0 && range.comparePoint(p.node, p.offset + 1) <= 0) {
        if (first < 0) first = i;
        lastIdx = i;
      }
    } catch {
      // node outside the range's document
    }
  });
  if (first < 0) return "";
  // Snap to whole words: a drag rarely starts or ends exactly on a word boundary.
  const t = index.text;
  while (first > 0 && t[first - 1] !== " ") first--;
  while (lastIdx < t.length - 1 && t[lastIdx + 1] !== " ") lastIdx++;
  return t.slice(first, lastIdx + 1).trim();
}

/** Range of the first occurrence of `quote` in the index, or null. */
export function findRange(index: TextIndex, quote: string): Range | null {
  const q = normalize(quote);
  if (!q) return null;
  const at = index.text.indexOf(q);
  const start = index.pos[at];
  const end = index.pos[at + q.length - 1];
  if (at < 0 || !start || !end) return null;
  const range = start.node.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, Math.min(end.offset + 1, end.node.data.length));
  return range;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Client rects of a range merged into one box per line, relative to `origin`. */
export function lineBoxes(range: Range, origin: DOMRect): Box[] {
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: DOMRect[] = [];
  for (const r of rects) {
    const line = lines.find((l) => Math.abs(l.top - r.top) < Math.min(l.height, r.height) / 2);
    if (!line) {
      lines.push(DOMRect.fromRect(r));
      continue;
    }
    const left = Math.min(line.left, r.left);
    const right = Math.max(line.right, r.right);
    const top = Math.min(line.top, r.top);
    const bottom = Math.max(line.bottom, r.bottom);
    line.x = left;
    line.y = top;
    line.width = right - left;
    line.height = bottom - top;
  }
  return lines.map((l) => ({ left: l.left - origin.left, top: l.top - origin.top, width: l.width, height: l.height }));
}
