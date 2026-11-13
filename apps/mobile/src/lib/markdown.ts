/*
 * Minimal Markdown → blocks for the phone's reader (no dependency): headings, paragraphs,
 * bullet / numbered lists, quotes, images and rules. Inline: **bold**, [links](url), `code`.
 * Enough for clipped articles and notes; tables and HTML fall back to plain text.
 */

/** `wiki`: the target of a `[[wiki-link]]` (the text shows the alias when there is one). */
export type Inline = { text: string; bold?: boolean; code?: boolean; href?: string; wiki?: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: Inline[] }
  | { kind: "para"; text: Inline[] }
  | { kind: "bullet"; text: Inline[]; ordered?: number; done?: boolean; task?: boolean; indent?: number }
  | { kind: "quote"; text: Inline[] }
  | { kind: "image"; url: string; alt: string }
  | { kind: "rule" };

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)|\[\[[^\]]+\]\])/g;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: s.slice(last, i) });
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) out.push({ text: tok.slice(2, -2), bold: true });
    else if (tok.startsWith("`")) out.push({ text: tok.slice(1, -1), code: true });
    else if (tok.startsWith("[[")) {
      const [target, alias] = tok.slice(2, -2).split("|");
      const clean = target!.trim();
      out.push({ text: (alias ?? clean.split("#")[0]!).trim() || clean, bold: true, ...(clean ? { wiki: clean } : {}) });
    }
    else {
      const lm = /^\[([^\]]*)\]\(([^)\s]+)/.exec(tok)!;
      out.push({ text: lm[1] || lm[2]!, href: lm[2] });
    }
    last = i + tok.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  // Stray emphasis markers (single * or _) are noise on a phone.
  return out.map((p) => (p.code || p.href || p.wiki ? p : { ...p, text: p.text.replace(/(^|\s)[*_](\S)/g, "$1$2").replace(/(\S)[*_](\s|$)/g, "$1$2") })).filter((p) => p.text);
}

/** Nesting of a list line: two spaces (or a tab) per level, at most three levels. */
const indentOf = (line: string): { indent?: number } => {
  const n = Math.min(3, Math.floor(/^[ \t]*/.exec(line)![0].replace(/\t/g, "  ").length / 2));
  return n ? { indent: n } : {};
};

const IMG_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;

export function parseMarkdown(md: string, maxBlocks = 400): Block[] {
  const src = md.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: parseInline(para.join(" ")) });
    para = [];
  };
  let inCode = false;
  for (const raw of src.split("\n")) {
    if (blocks.length >= maxBlocks) break;
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) {
      flush();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      blocks.push({ kind: "para", text: [{ text: line, code: true }] });
      continue;
    }
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(t))) {
      flush();
      blocks.push({ kind: "heading", level: Math.min(3, m[1]!.length) as 1 | 2 | 3, text: parseInline(m[2]!.replace(/\s*#+$/, "")) });
    } else if ((m = IMG_LINE.exec(t))) {
      flush();
      if (/^https?:\/\//.test(m[2]!)) blocks.push({ kind: "image", url: m[2]!, alt: m[1]! });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      blocks.push({ kind: "rule" });
    } else if ((m = /^[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(t))) {
      flush();
      blocks.push({ kind: "bullet", text: parseInline(m[2]!), ...(m[1] !== undefined ? { task: true, done: m[1] !== " " } : {}), ...indentOf(line) });
    } else if ((m = /^(\d+)[.)]\s+(.*)$/.exec(t))) {
      flush();
      blocks.push({ kind: "bullet", text: parseInline(m[2]!), ordered: Number(m[1]), ...indentOf(line) });
    } else if ((m = /^>\s?(.*)$/.exec(t))) {
      flush();
      if (m[1]) blocks.push({ kind: "quote", text: parseInline(m[1]) });
    } else {
      // Inline images inside a paragraph become their own block.
      const imgs = [...t.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
      if (imgs.length) {
        const rest = t.replace(/!\[[^\]]*\]\([^)\s]+\)/g, "").trim();
        if (rest) para.push(rest);
        flush();
        for (const im of imgs) if (/^https?:\/\//.test(im[2]!)) blocks.push({ kind: "image", url: im[2]!, alt: im[1]! });
      } else para.push(t);
    }
  }
  flush();
  return blocks;
}

/** Headings under which an item keeps its key points (written by Kortex's adapters). */
const KEY_SECTION = /^(kernpunkte|kernaussagen|key takeaways|takeaways|key points|wichtigste punkte|zusammenfassung|highlights)\b/i;

/** Bullets of the first key-point section, else none (random page bullets are not key points). */
export function keyPointsOf(md: string, max = 6): string[] {
  const blocks = parseMarkdown(md);
  const out: string[] = [];
  let inSection = false;
  for (const b of blocks) {
    if (b.kind === "heading") {
      if (inSection && out.length) break;
      inSection = KEY_SECTION.test(b.text.map((p) => p.text).join("").trim());
    } else if (inSection && b.kind === "bullet") {
      out.push(b.text.map((p) => p.text).join("").trim());
      if (out.length >= max) break;
    }
  }
  return out.filter(Boolean);
}
