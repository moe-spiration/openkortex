// Text-quote + DOM-range anchoring for inline highlights (payload of item_highlights.locator).
// Operates on a "text stream": all visible text nodes under a root in document order, skipping
// script/style and Kortex's own UI, so offsets survive our own <mark> wrappers.
import type { HighlightLocator } from "../api";

export const HIGHLIGHT_CLASS = "kortex-hl";
export const UI_ATTR = "data-kortex-ui";
const CONTEXT = 32;
const MAX_QUOTE = 5000;
const SKIP = "script, style, noscript, template, textarea, [data-kortex-ui]";

function textNodes(root: Node): Text[] {
  const doc = root.ownerDocument ?? (root as Document);
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode: (n) =>
      (n.parentElement?.closest(SKIP) ? 2 /* REJECT */ : 1 /* ACCEPT */) as 1 | 2,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

interface Stream {
  nodes: Text[];
  starts: number[];
  text: string;
}

function buildStream(root: Node): Stream {
  const nodes = textNodes(root);
  const starts: number[] = [];
  let text = "";
  for (const n of nodes) {
    starts.push(text.length);
    text += n.data;
  }
  return { nodes, starts, text };
}

/** Stream offset of (node, offset); null when the node is not part of the stream. */
function offsetOf(stream: Stream, node: Node, offset: number): number | null {
  if (node.nodeType === 3) {
    const i = stream.nodes.indexOf(node as Text);
    return i < 0 ? null : (stream.starts[i] ?? 0) + offset;
  }
  // Element boundary: the first stream node at/after the boundary child.
  const child = node.childNodes[offset];
  if (child) {
    const i = stream.nodes.findIndex((n) => child === n || child.contains(n) || (child.compareDocumentPosition(n) & 4) !== 0);
    if (i >= 0) return stream.starts[i] ?? 0;
  }
  const last = stream.nodes.length - 1;
  return last < 0 ? 0 : (stream.starts[last] ?? 0) + (stream.nodes[last]?.data.length ?? 0);
}

function pointAt(stream: Stream, offset: number, preferEnd: boolean): { node: Text; offset: number } | null {
  for (let i = 0; i < stream.nodes.length; i++) {
    const node = stream.nodes[i]!;
    const start = stream.starts[i]!;
    const end = start + node.data.length;
    if (offset < end || (preferEnd && offset === end)) {
      if (offset >= start) return { node, offset: offset - start };
    }
  }
  return null;
}

function rangeFromOffsets(root: Node, stream: Stream, start: number, end: number): Range | null {
  const a = pointAt(stream, start, false);
  const b = pointAt(stream, end, true);
  if (!a || !b) return null;
  const range = (root.ownerDocument ?? (root as Document)).createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

// --- XPath of text nodes ---------------------------------------------------------------------

export function xpathOf(node: Node, root: Node): string {
  const parts: string[] = [];
  let cur: Node | null = node;
  while (cur && cur !== root) {
    const parent: Node | null = cur.parentNode;
    if (!parent) break;
    if (cur.nodeType === 3) {
      const idx = [...parent.childNodes].filter((n) => n.nodeType === 3).indexOf(cur as ChildNode) + 1;
      parts.unshift(`text()[${idx}]`);
    } else {
      const name = cur.nodeName.toLowerCase();
      const idx = [...parent.childNodes].filter((n) => n.nodeName === cur!.nodeName).indexOf(cur as ChildNode) + 1;
      parts.unshift(`${name}[${idx}]`);
    }
    cur = parent;
  }
  return `/${parts.join("/")}`;
}

export function nodeFromXPath(xpath: string, root: Node): Node | null {
  let cur: Node | null = root;
  for (const step of xpath.split("/").filter(Boolean)) {
    const m = /^([\w#:-]+(?:\(\))?)\[(\d+)\]$/.exec(step);
    if (!m || !cur) return null;
    const [, name, nth] = m;
    const wantText = name === "text()";
    const siblings: ChildNode[] = [...cur.childNodes].filter((n) =>
      wantText ? n.nodeType === 3 : n.nodeName.toLowerCase() === name,
    );
    cur = siblings[Number(nth) - 1] ?? null;
  }
  return cur === root ? null : cur;
}

// --- public API ------------------------------------------------------------------------------

/** Builds the locator for a (non-collapsed) range inside `root`. Null for empty/oversized/foreign ranges. */
export function buildLocator(range: Range, root: Node): HighlightLocator | null {
  const stream = buildStream(root);
  let start = offsetOf(stream, range.startContainer, range.startOffset);
  let end = offsetOf(stream, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  while (start < end && /\s/.test(stream.text[start]!)) start++;
  while (end > start && /\s/.test(stream.text[end - 1]!)) end--;
  if (end <= start || end - start > MAX_QUOTE) return null;

  const trimmed = rangeFromOffsets(root, stream, start, end);
  const a = pointAt(stream, start, false);
  const b = pointAt(stream, end, true);
  if (!trimmed || !a || !b) return null;
  return {
    v: 1,
    quote: {
      exact: stream.text.slice(start, end),
      prefix: stream.text.slice(Math.max(0, start - CONTEXT), start),
      suffix: stream.text.slice(end, end + CONTEXT),
    },
    position: { start, end },
    range: {
      startXPath: xpathOf(a.node, root),
      startOffset: a.offset,
      endXPath: xpathOf(b.node, root),
      endOffset: b.offset,
    },
  };
}

/** Finds the highlighted text again; null when the page changed too much. */
export function resolveLocator(locator: HighlightLocator, root: Node): Range | null {
  const stream = buildStream(root);
  const { exact, prefix, suffix } = locator.quote;
  const doc = root.ownerDocument ?? (root as Document);

  // 1) exact DOM range, verified against the quote.
  const s = nodeFromXPath(locator.range.startXPath, root);
  const e = nodeFromXPath(locator.range.endXPath, root);
  if (s && e && s.nodeType === 3 && e.nodeType === 3) {
    try {
      const r = doc.createRange();
      r.setStart(s, locator.range.startOffset);
      r.setEnd(e, locator.range.endOffset);
      if (r.toString() === exact) return r;
    } catch {
      /* offsets out of range: fall through */
    }
  }

  // 2) text quote search, disambiguated by prefix/suffix and distance to the old position.
  const hits: number[] = [];
  for (let i = stream.text.indexOf(exact); i >= 0; i = stream.text.indexOf(exact, i + 1)) hits.push(i);
  if (hits.length === 0) return null;
  const score = (i: number) => {
    const before = stream.text.slice(Math.max(0, i - prefix.length), i);
    const after = stream.text.slice(i + exact.length, i + exact.length + suffix.length);
    const ctx = (before.endsWith(prefix) ? 2 : 0) + (after.startsWith(suffix) ? 2 : 0);
    return ctx * 1e6 - Math.abs(i - locator.position.start);
  };
  const best = hits.reduce((a, b) => (score(b) > score(a) ? b : a));
  return rangeFromOffsets(root, stream, best, best + exact.length);
}

/** Wraps the range's text in <mark class="kortex-hl">, one per text node. Returns the marks. */
export function markRange(range: Range, id: string): HTMLElement[] {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? (root as Document);
  const nodes = textNodes(root.nodeType === 3 ? (root.parentNode ?? root) : root).filter((n) => range.intersectsNode(n));
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    if (to <= from) continue;
    const middle = from > 0 ? node.splitText(from) : node;
    if (to - from < middle.data.length) middle.splitText(to - from);
    if (!middle.data.trim() && middle.data.length < 1) continue;
    const mark = doc.createElement("mark");
    mark.className = HIGHLIGHT_CLASS;
    mark.dataset.kortexHl = id;
    middle.parentNode?.insertBefore(mark, middle);
    mark.appendChild(middle);
    marks.push(mark);
  }
  return marks;
}

export function removeMarks(root: ParentNode, id: string) {
  for (const mark of root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}[data-kortex-hl="${CSS.escape(id)}"]`)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  }
}

/** Page-level style for the marks (not inside the shadow UI: the marks live in the page's DOM). Classic look. */
export const HIGHLIGHT_CSS = `mark.${HIGHLIGHT_CLASS}{background:color-mix(in srgb,#F59E0B 32%,transparent);color:inherit;border-radius:3px;padding:0 1px;cursor:pointer}`;

/** OKLCH hue per highlight colour: sand, indigo, sage, rose. */
export const HIGHLIGHT_HUES: Record<string, number> = { yellow: 85, indigo: 276, green: 150, pink: 15 };

/**
 * Ruhe marks: a calm low-chroma fill plus a 1.5 px underline in the colour's hue (`data-kx-color`). On dark pages
 * (`data-kx-dark` on the mark, decided from the page background) the fill is darker and the line lighter, so the
 * text keeps its contrast. A focused mark (jump from the side panel) gets a short ring.
 */
export const HIGHLIGHT_CSS_RUHE = [
  `mark.${HIGHLIGHT_CLASS}{--kx-h:85;background:oklch(0.90 0.07 var(--kx-h)/.55);color:inherit;border-radius:2px;padding:0 1px;cursor:pointer;box-shadow:inset 0 -1.5px 0 oklch(0.66 0.13 var(--kx-h));transition:box-shadow .18s cubic-bezier(.16,1,.3,1)}`,
  `mark.${HIGHLIGHT_CLASS}[data-kx-dark]{background:oklch(0.62 0.09 var(--kx-h)/.30);box-shadow:inset 0 -1.5px 0 oklch(0.76 0.12 var(--kx-h))}`,
  ...Object.entries(HIGHLIGHT_HUES).map(([c, h]) => `mark.${HIGHLIGHT_CLASS}[data-kx-color="${c}"]{--kx-h:${h}}`),
  `mark.${HIGHLIGHT_CLASS}[data-kx-focus]{outline:2px solid oklch(0.63 0.155 276/.55);outline-offset:1px}`,
  `mark.${HIGHLIGHT_CLASS}[data-kx-pending]{opacity:.7}`,
].join("\n");

/** Colour (and page brightness) of the marks of one highlight. */
export function styleMarks(root: ParentNode, id: string, color: string | undefined, dark: boolean) {
  for (const mark of root.querySelectorAll<HTMLElement>(`mark.${HIGHLIGHT_CLASS}[data-kortex-hl="${CSS.escape(id)}"]`)) {
    mark.dataset.kxColor = color ?? "yellow";
    if (dark) mark.dataset.kxDark = "";
    else delete mark.dataset.kxDark;
  }
}
