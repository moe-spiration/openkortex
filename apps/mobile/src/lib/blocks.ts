import { msg, t } from "../i18n";
/*
 * A3: block model of the mobile note editor (Notion-like, mirrors the web BlockNote editor).
 * content_md stays the source of truth: parse() turns Markdown into blocks, serialize() writes
 * clean Markdown back. Anything the phone cannot edit as a block (tables, HTML, front matter)
 * becomes a "raw" block that is kept verbatim. Pure functions, tested without React Native.
 */

export type BlockType = "p" | "h1" | "h2" | "h3" | "bullet" | "number" | "check" | "quote" | "code" | "divider" | "image" | "raw";

export interface Block {
  id: string;
  type: BlockType;
  text: string;
  /** check: done. */
  checked?: boolean;
  /** Lists: nesting level (two spaces per level). */
  indent?: number;
  /** code: fence language. image: URL. */
  lang?: string;
  url?: string;
}

let seq = 0;
export const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export const block = (type: BlockType, text = "", extra: Partial<Block> = {}): Block => ({ id: newId(), type, text, ...extra });

const LIST_TYPES: BlockType[] = ["bullet", "number", "check"];
export const isList = (t: BlockType) => LIST_TYPES.includes(t);
/** Blocks whose text is one logical line: Enter starts a new block. */
export const isSingleLine = (t: BlockType) => t === "h1" || t === "h2" || t === "h3" || isList(t);
/** Blocks without editable text. */
export const isAtom = (t: BlockType) => t === "divider" || t === "image";

const RE = {
  fence: /^\s*(```|~~~)\s*([\w+-]*)\s*$/,
  heading: /^(#{1,6})\s+(.*)$/,
  check: /^(\s*)[-*+]\s+\[([ xX])\]\s?(.*)$/,
  bullet: /^(\s*)[-*+]\s+(.*)$/,
  number: /^(\s*)\d+[.)]\s+(.*)$/,
  quote: /^>\s?(.*)$/,
  divider: /^\s*([-*_])(\s*\1){2,}\s*$/,
  image: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/,
  table: /^\s*\|/,
  html: /^\s*<\/?[a-zA-Z][^>]*>/,
};

const indentOf = (ws: string) => Math.min(6, Math.floor(ws.replace(/\t/g, "  ").length / 2));

export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  // Front matter stays as it is.
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      out.push(block("raw", lines.slice(0, end + 1).join("\n")));
      i = end + 1;
    }
  }

  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(block("p", para.join("\n")));
    para = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = RE.fence.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[j]!)) body.push(lines[j++]!);
      out.push(block("code", body.join("\n"), { lang: fence[2] || "" }));
      i = j;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (RE.divider.test(line) && !para.length) {
      out.push(block("divider"));
      continue;
    }
    let m = RE.heading.exec(line);
    if (m) {
      flush();
      const lvl = Math.min(3, m[1]!.length) as 1 | 2 | 3;
      out.push(block(`h${lvl}`, m[2]!.replace(/\s+#+\s*$/, "")));
      continue;
    }
    m = RE.check.exec(line);
    if (m) {
      flush();
      out.push(block("check", m[3]!, { checked: m[2] !== " ", indent: indentOf(m[1]!) }));
      continue;
    }
    m = RE.bullet.exec(line);
    if (m) {
      flush();
      out.push(block("bullet", m[2]!, { indent: indentOf(m[1]!) }));
      continue;
    }
    m = RE.number.exec(line);
    if (m) {
      flush();
      out.push(block("number", m[2]!, { indent: indentOf(m[1]!) }));
      continue;
    }
    m = RE.quote.exec(line);
    if (m) {
      flush();
      const body = [m[1]!];
      while (i + 1 < lines.length && RE.quote.test(lines[i + 1]!)) body.push(RE.quote.exec(lines[++i]!)![1]!);
      out.push(block("quote", body.join("\n")));
      continue;
    }
    m = RE.image.exec(line);
    if (m && !para.length) {
      out.push(block("image", m[1]!, { url: m[2]! }));
      continue;
    }
    if (RE.table.test(line) || (RE.html.test(line) && !para.length)) {
      flush();
      const body = [line];
      while (i + 1 < lines.length && lines[i + 1]!.trim()) body.push(lines[++i]!);
      out.push(block("raw", body.join("\n")));
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

function line(b: Block, n: number): string {
  const pad = "  ".repeat(b.indent ?? 0);
  switch (b.type) {
    case "p":
      return b.text;
    case "h1":
      return `# ${b.text}`;
    case "h2":
      return `## ${b.text}`;
    case "h3":
      return `### ${b.text}`;
    case "bullet":
      return `${pad}- ${b.text}`;
    case "number":
      return `${pad}${n}. ${b.text}`;
    case "check":
      return `${pad}- [${b.checked ? "x" : " "}] ${b.text}`;
    case "quote":
      return b.text
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "code":
      return "```" + (b.lang ?? "") + "\n" + b.text + "\n```";
    case "divider":
      return "---";
    case "image":
      return `![${b.text}](${b.url ?? ""})`;
    case "raw":
      return b.text;
  }
}

export function serialize(blocks: Block[]): string {
  const parts: string[] = [];
  /** Type of the current list's top-level items (null outside a list). */
  let root: BlockType | null = null;
  blocks.forEach((b, i) => {
    // An empty paragraph is a spacer while typing, not content.
    if (b.type === "p" && !b.text.trim()) {
      root = null;
      return;
    }
    // Items of one list stay together (nested items of any kind too); two lists keep a blank line.
    const nested = (b.indent ?? 0) > 0;
    const tight = root !== null && isList(b.type) && (nested || b.type === root);
    if (parts.length) parts.push(tight ? "\n" : "\n\n");
    parts.push(line(b, b.type === "number" ? numberOf(blocks, i) : 0));
    if (!isList(b.type)) root = null;
    else if (!nested || root === null) root = b.type;
  });
  return parts.length ? parts.join("") + "\n" : "";
}

/** Markdown as the block editor would write it (for a dirty check that ignores cosmetic differences). */
export const normalize = (md: string) => serialize(parse(md));

/* ---------- Editing ---------- */

/**
 * Index in `next` of the one newline the user just typed (null when the change added no line or
 * several). Android keyboards often commit an autocorrected word together with Enter
 * ("teh" → "the\n"), so this compares lines, not only a one-character insert.
 */
export function insertedNewline(prev: string, next: string): number | null {
  if (next.length === prev.length + 1) {
    let i = 0;
    while (i < prev.length && prev[i] === next[i]) i++;
    if (next[i] === "\n" && next.slice(i + 1) === prev.slice(i)) return i;
  }
  const a = prev.split("\n");
  const b = next.split("\n");
  if (b.length !== a.length + 1) return null;
  let k = 0;
  while (k < a.length && a[k] === b[k]) k++;
  let at = 0;
  for (let j = 0; j <= k; j++) at += b[j]!.length + (j < k ? 1 : 0);
  return at;
}

/** The block that follows when Enter is pressed at the end of `b`. */
export function continuation(b: Block): Block {
  if (isList(b.type)) return block(b.type, "", { indent: b.indent ?? 0, ...(b.type === "check" ? { checked: false } : {}) });
  return block("p");
}

export interface EditResult {
  blocks: Block[];
  /** Block to focus and the cursor position in it. */
  focus: { id: string; pos: number } | null;
}

/** Enter at `pos` in block i: splits it; Enter in an empty list item / heading leaves the list. */
export function splitAt(blocks: Block[], i: number, pos: number): EditResult {
  const b = blocks[i]!;
  if (isList(b.type) && !b.text.trim()) {
    if ((b.indent ?? 0) > 0) return replace(blocks, i, { ...b, indent: (b.indent ?? 0) - 1 }, 0);
    return replace(blocks, i, { ...b, type: "p", text: "", indent: undefined, checked: undefined }, 0);
  }
  const before = b.text.slice(0, pos);
  const after = b.text.slice(pos);
  const next = { ...continuation(b), text: after };
  // Enter at the very start of a non-empty block pushes it down instead of splitting a heading's style off.
  if (pos === 0 && b.text) {
    const empty = { ...continuation(b), type: isList(b.type) ? b.type : ("p" as BlockType) };
    const out = [...blocks.slice(0, i), empty, ...blocks.slice(i)];
    return { blocks: out, focus: { id: b.id, pos: 0 } };
  }
  const out = [...blocks.slice(0, i), { ...b, text: before }, next, ...blocks.slice(i + 1)];
  return { blocks: out, focus: { id: next.id, pos: 0 } };
}

function replace(blocks: Block[], i: number, b: Block, pos: number): EditResult {
  const out = blocks.slice();
  out[i] = b;
  return { blocks: out, focus: { id: b.id, pos } };
}

/** Backspace at position 0 of block i: lift formatting, else merge into the previous block. */
export function backspaceAtStart(blocks: Block[], i: number): EditResult | null {
  const b = blocks[i]!;
  if (b.type !== "p" && b.type !== "raw" && b.type !== "code") {
    if (isList(b.type) && (b.indent ?? 0) > 0) return replace(blocks, i, { ...b, indent: (b.indent ?? 0) - 1 }, 0);
    return replace(blocks, i, { id: b.id, type: "p", text: b.text }, 0);
  }
  if (b.type === "code" && b.text) return null;
  if (i === 0) return null;
  const prev = blocks[i - 1]!;
  if (isAtom(prev.type)) {
    // Remove the divider / image above instead of merging into it.
    const out = [...blocks.slice(0, i - 1), ...blocks.slice(i)];
    return { blocks: out, focus: { id: b.id, pos: 0 } };
  }
  const merged = { ...prev, text: prev.text + b.text };
  const out = [...blocks.slice(0, i - 1), merged, ...blocks.slice(i + 1)];
  return { blocks: out, focus: { id: prev.id, pos: prev.text.length } };
}

/** Markdown shortcuts typed at the start of a paragraph ("# ", "- ", "[] ", "1. ", "> ", "```", "---"). */
export function autoFormat(b: Block): Block | null {
  const t = b.text;
  if (b.type !== "p") {
    // "## " at the start of a list item or quote turns it into a heading (checkbox or bullet go away).
    if (!isList(b.type) && b.type !== "quote") return null;
    const h = /^(#{1,3}) (.*)$/s.exec(t);
    return h ? { id: b.id, type: `h${h[1]!.length}` as BlockType, text: h[2]!.replace(/\n/g, " ") } : null;
  }
  const rules: [RegExp, (m: RegExpExecArray) => Partial<Block>][] = [
    [/^(#{1,3}) (.*)$/s, (m) => ({ type: `h${m[1]!.length}` as BlockType, text: m[2]! })],
    [/^(?:- )?\[( |x)?\] (.*)$/s, (m) => ({ type: "check", text: m[2]!, checked: m[1] === "x", indent: 0 })],
    [/^[-*+] (.*)$/s, (m) => ({ type: "bullet", text: m[1]!, indent: 0 })],
    [/^1[.)] (.*)$/s, (m) => ({ type: "number", text: m[1]!, indent: 0 })],
    [/^> (.*)$/s, (m) => ({ type: "quote", text: m[1]! })],
    [/^```(\w*)$/, (m) => ({ type: "code", text: "", lang: m[1]! })],
    [/^(---|\*\*\*|___)$/, () => ({ type: "divider", text: "" })],
  ];
  for (const [re, f] of rules) {
    const m = re.exec(t);
    if (m) return { ...b, ...f(m) };
  }
  return null;
}

/** Converts block i to another type (slash menu / type picker), keeping its text where it makes sense. */
export function convert(blocks: Block[], i: number, type: BlockType): EditResult {
  const b = blocks[i]!;
  const text = isAtom(type) ? "" : b.text.replace(/\n/g, isSingleLine(type) ? " " : "\n");
  const nb: Block = { id: b.id, type, text, ...(isList(type) ? { indent: b.indent ?? 0 } : {}), ...(type === "check" ? { checked: false } : {}), ...(type === "code" ? { lang: "" } : {}) };
  const out = blocks.slice();
  out[i] = nb;
  if (isAtom(type)) {
    // An atom needs a text block after it to keep typing.
    const after = blocks[i + 1];
    if (!after || isAtom(after.type)) {
      const p = block("p");
      out.splice(i + 1, 0, p);
      return { blocks: out, focus: { id: p.id, pos: 0 } };
    }
    return { blocks: out, focus: { id: after.id, pos: 0 } };
  }
  return { blocks: out, focus: { id: nb.id, pos: nb.text.length } };
}

export function setIndent(blocks: Block[], i: number, delta: 1 | -1): Block[] {
  const b = blocks[i]!;
  if (!isList(b.type)) return blocks;
  const prev = blocks[i - 1];
  const max = prev && isList(prev.type) ? (prev.indent ?? 0) + 1 : 0;
  const indent = Math.max(0, Math.min(max, (b.indent ?? 0) + delta));
  const out = blocks.slice();
  out[i] = { ...b, indent };
  return out;
}

export function move(blocks: Block[], i: number, delta: 1 | -1): Block[] {
  const j = i + delta;
  if (j < 0 || j >= blocks.length) return blocks;
  const out = blocks.slice();
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function remove(blocks: Block[], i: number): EditResult {
  const out = blocks.filter((_, k) => k !== i);
  if (!out.length) {
    const p = block("p");
    return { blocks: [p], focus: { id: p.id, pos: 0 } };
  }
  const f = out[Math.max(0, i - 1)]!;
  return { blocks: out, focus: isAtom(f.type) ? null : { id: f.id, pos: f.text.length } };
}

/** Number shown in front of a numbered item (counts the run at the same indent). */
export function numberOf(blocks: Block[], i: number): number {
  const lvl = blocks[i]!.indent ?? 0;
  let n = 1;
  for (let k = i - 1; k >= 0; k--) {
    const b = blocks[k]!;
    if (!isList(b.type)) break;
    const l = b.indent ?? 0;
    if (l < lvl) break;
    if (l === lvl) {
      if (b.type !== "number") break;
      n++;
    }
  }
  return n;
}

/* ---------- Slash menu ---------- */

export interface BlockKind {
  type: BlockType;
  /** English source; shown with `t(kind.label)`. */
  label: string;
  /** Markdown shortcut, or an English source ("Paragraph"); shown with `t(kind.hint)`. */
  hint: string;
  keys: string[];
}

export const BLOCK_KINDS: BlockKind[] = [
  { type: "p", label: msg("Text"), hint: msg("Paragraph"), keys: ["text", "absatz", "paragraph", "p"] },
  { type: "h1", label: msg("Heading 1"), hint: "#", keys: ["h1", "überschrift", "titel", "heading", "title"] },
  { type: "h2", label: msg("Heading 2"), hint: "##", keys: ["h2", "überschrift", "heading"] },
  { type: "h3", label: msg("Heading 3"), hint: "###", keys: ["h3", "überschrift", "heading"] },
  { type: "bullet", label: msg("List"), hint: "-", keys: ["liste", "aufzählung", "list", "bullet", "ul"] },
  { type: "number", label: msg("Numbered list"), hint: "1.", keys: ["nummer", "nummeriert", "zahl", "number", "numbered", "ol"] },
  { type: "check", label: msg("Checklist"), hint: "[ ]", keys: ["check", "checkliste", "checklist", "aufgabe", "todo", "task"] },
  { type: "quote", label: msg("Quote"), hint: ">", keys: ["zitat", "quote"] },
  { type: "code", label: msg("Code"), hint: "```", keys: ["code"] },
  { type: "divider", label: msg("Divider"), hint: "---", keys: ["trenner", "trennlinie", "linie", "divider", "line", "hr"] },
];

export function slashMatches(query: string): BlockKind[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_KINDS;
  return BLOCK_KINDS.filter((k) => t(k.label).toLowerCase().includes(q) || k.keys.some((x) => x.startsWith(q)));
}

/** "/check" in an otherwise empty paragraph → the query ("check"); null when no slash command is typed. */
export function slashQuery(b: Block): string | null {
  if (b.type !== "p") return null;
  const m = /^\/([\p{L}\d]*)$/u.exec(b.text);
  return m ? m[1]! : null;
}

/* ---------- Inline formatting (live styling inside a text field) ---------- */

export interface Seg {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: boolean;
  /** Markdown syntax characters (shown muted). */
  mark?: boolean;
}

const INLINE = /(\*\*([^*\n]+)\*\*)|(~~([^~\n]+)~~)|(`([^`\n]+)`)|(\[\[([^\]\n]+)\]\])|(\[([^\]\n]+)\]\(([^)\s]+)\))|((?<![\w*])\*([^*\n]+)\*(?!\*))|((?<!\w)_([^_\n]+)_(?!\w))/g;

/** Splits a block's text into styled segments. Concatenating the segments gives the text back exactly. */
export function inlineSegments(text: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1]) out.push({ text: "**", mark: true }, { text: m[2]!, bold: true }, { text: "**", mark: true });
    else if (m[3]) out.push({ text: "~~", mark: true }, { text: m[4]!, strike: true }, { text: "~~", mark: true });
    else if (m[5]) out.push({ text: "`", mark: true }, { text: m[6]!, code: true }, { text: "`", mark: true });
    else if (m[7]) out.push({ text: "[[", mark: true }, { text: m[8]!, link: true }, { text: "]]", mark: true });
    else if (m[9]) out.push({ text: "[", mark: true }, { text: m[10]!, link: true }, { text: `](${m[11]})`, mark: true });
    else if (m[12]) out.push({ text: "*", mark: true }, { text: m[13]!, italic: true }, { text: "*", mark: true });
    else if (m[14]) out.push({ text: "_", mark: true }, { text: m[15]!, italic: true }, { text: "_", mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
