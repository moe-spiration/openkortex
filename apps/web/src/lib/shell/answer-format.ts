/*
 * Tiny Markdown subset for copilot answers (streamed, so it must tolerate half-written input):
 * headings, paragraphs, bullet / numbered lists, block quotes, code fences, and inline bold,
 * italic, code, links and citations "[1]" / "[1, 3]" / "[1][2]".
 */

import { t } from "@/i18n";

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "cite"; n: number };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "pre"; v: string };

const INLINE =
  /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[((?:\d+\s*,\s*)*\d+)\](?!\())|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\*([^*\s][^*]*)\*)|(_([^_\s][^_]*)_)/g;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: s.slice(last, at) });
    if (m[1]) out.push({ t: "b", c: parseInline(m[2]!) });
    else if (m[3]) out.push({ t: "code", v: m[4]! });
    else if (m[5])
      for (const n of m[6]!.split(",")) out.push({ t: "cite", n: Number(n.trim()) });
    else if (m[7]) out.push({ t: "link", href: m[9]!, c: parseInline(m[8]!) });
    else if (m[10]) out.push({ t: "i", c: parseInline(m[11]!) });
    else if (m[12]) out.push({ t: "i", c: parseInline(m[13]!) });
    last = at + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

export function parseAnswer(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith("```"); i++) code.push(lines[i]!);
      blocks.push({ t: "pre", v: code.join("\n") });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flush();
      blocks.push({ t: "h", level: Math.min(3, h[1]!.length) as 1 | 2 | 3, c: parseInline(h[2]!) });
      continue;
    }
    const li = /^([-*•]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (li) {
      flush();
      const kind = /\d/.test(li[1]!) ? "ol" : "ul";
      const prev = blocks[blocks.length - 1];
      const item = parseInline(li[2]!);
      if (prev && prev.t === kind) prev.items.push(item);
      else blocks.push({ t: kind, items: [item] });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      blocks.push({ t: "quote", c: parseInline(trimmed.replace(/^>\s?/, "")) });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

/** Citation numbers used in an answer, in order of first use. */
export function citedNumbers(md: string): number[] {
  const seen = new Set<number>();
  const walk = (c: Inline[]) => {
    for (const x of c) {
      if (x.t === "cite") seen.add(x.n);
      else if (x.t === "b" || x.t === "i" || x.t === "link") walk(x.c);
    }
  };
  for (const b of parseAnswer(md)) {
    if (b.t === "ul" || b.t === "ol") b.items.forEach(walk);
    else if (b.t === "h" || b.t === "p" || b.t === "quote") walk(b.c);
  }
  return [...seen];
}

/**
 * "Als Notiz speichern" under an answer (Tactile Craft decision 8): the question becomes the title,
 * the answer the body (Markdown as streamed, with its [n] citations) and the cited sources a
 * numbered list of wiki links, so the note stays portable and links back into the vault.
 */
export function answerNote(
  question: string,
  answerMd: string,
  sources: readonly { n: number; title: string }[] = [],
): { title: string; body: string } {
  const q = question.replace(/\s+/g, " ").trim();
  const title = (q.length > 120 ? q.slice(0, 119).trimEnd() + "…" : q).replace(/\?$/, "") || t("Answer");
  const cited = new Set(citedNumbers(answerMd));
  const used = sources.filter((s) => cited.has(s.n)).sort((a, b) => a.n - b.n);
  const list = used.map((s) => `${s.n}. [[${s.title.replace(/[[\]]/g, "")}]]`).join("\n");
  const body = [q ? `> ${q}` : "", answerMd.trim(), list ? `## ${t("Sources")}\n\n${list}` : ""].filter(Boolean).join("\n\n");
  return { title, body };
}
