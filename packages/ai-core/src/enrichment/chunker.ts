import { ph } from "../i18n";
import type { StructuralChunk } from "../adapters/base-adapter";

export interface ChunkerOptions {
  /** Small heading sections are merged until they reach this size. Default 500. */
  minTokens?: number;
  /** Hard upper bound for chunk content. Default 800. */
  maxTokens?: number;
  /** Share of the previous chunk repeated at the start of the next one. Default 0.15. */
  overlapRatio?: number;
}

export interface ChunkInput {
  title: string;
  type: string;
  contentMd: string;
  /** Page/chapter/timestamp sections from the adapter. When present they replace heading splitting. */
  structuralChunks?: readonly StructuralChunk[];
}

export interface DocumentChunk {
  index: number;
  heading: string | null;
  pageOrTimestamp: string | null;
  /** Chunk body without the header. */
  content: string;
  /** Header + body: what gets embedded and stored in item_chunks.chunk_text. */
  text: string;
  tokenEstimate: number;
}

/** ~4 characters per token for German/English prose; good enough for sizing. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

interface Section {
  heading: string | null;
  pageOrTimestamp: string | null;
  text: string;
  /** Heading sections may be merged; pages/timestamps keep their exact locator. */
  mergeable: boolean;
}

/** Splits Markdown at headings (ignoring fenced code) and keeps the heading path, e.g. "Teil 1 > Kapitel 2". */
export function splitMarkdownSections(md: string): Section[] {
  const sections: Section[] = [];
  const path: string[] = [];
  let current: string[] = [];
  let heading: string | null = null;
  let inFence = false;
  const flush = () => {
    const text = current.join("\n").trim();
    if (text) sections.push({ heading, pageOrTimestamp: null, text, mergeable: true });
    current = [];
  };
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
    if (m?.[1] && m[2]) {
      flush();
      const level = m[1].length;
      path.length = Math.min(path.length, level - 1);
      path[level - 1] = m[2];
      heading = path.filter(Boolean).join(" > ");
    }
    current.push(line);
  }
  flush();
  return sections;
}

function mergeSmallSections(sections: Section[], minTokens: number, maxTokens: number): Section[] {
  const out: Section[] = [];
  for (const s of sections) {
    const prev = out.at(-1);
    if (
      prev &&
      prev.mergeable &&
      s.mergeable &&
      estimateTokens(prev.text) < minTokens &&
      estimateTokens(prev.text) + estimateTokens(s.text) <= maxTokens
    ) {
      prev.text = `${prev.text}\n\n${s.text}`;
      prev.heading ??= s.heading;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Breaks text into units no larger than `maxTokens`: paragraphs, then sentences, then words. */
function splitUnits(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;
  const units: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (estimateTokens(p) <= maxTokens) {
      units.push(p);
      continue;
    }
    for (const sentence of p.split(/(?<=[.!?…])\s+|\n/)) {
      if (estimateTokens(sentence) <= maxTokens) {
        if (sentence.trim()) units.push(sentence.trim());
        continue;
      }
      let rest = sentence.trim();
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(" ", maxChars);
        if (cut < maxChars / 2) cut = maxChars;
        units.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) units.push(rest);
    }
  }
  return units;
}

/** Last ~`ratio` of `text`, starting at a word boundary. */
function overlapTail(text: string, ratio: number): string {
  if (ratio <= 0) return "";
  const want = Math.floor(text.length * ratio);
  if (want <= 0) return "";
  let start = text.length - want;
  const space = text.indexOf(" ", start);
  if (space > 0 && space < text.length - 1) start = space + 1;
  return text.slice(start).trim();
}

const header = (input: ChunkInput, heading: string | null, pot: string | null): string =>
  [
    `${ph("chunkDocument")}: ${input.title}`,
    `${ph("type")}: ${input.type}`,
    heading ? `${ph("section")}: ${heading}` : null,
    pot ? `${ph("chunkPosition")}: ${pot}` : null,
  ]
    .filter(Boolean)
    .join("\n");

/** Contextual chunking for RAG: heading/page aware, 500-800 tokens, ~15% overlap, header prefix. */
export function chunkDocument(input: ChunkInput, options: ChunkerOptions = {}): DocumentChunk[] {
  const minTokens = options.minTokens ?? 500;
  const maxTokens = options.maxTokens ?? 800;
  const overlapRatio = options.overlapRatio ?? 0.15;
  // Units leave room for the overlap so overlap + unit never exceeds maxTokens.
  const unitMax = Math.max(Math.floor(maxTokens * (1 - overlapRatio)), 1);

  const sections: Section[] =
    input.structuralChunks && input.structuralChunks.length > 0
      ? input.structuralChunks
          .filter((c) => c.text.trim())
          .map((c) => ({
            heading: c.heading ?? null,
            pageOrTimestamp: c.pageOrTimestamp ?? null,
            text: c.text.trim(),
            mergeable: !c.pageOrTimestamp,
          }))
      : splitMarkdownSections(input.contentMd);

  const chunks: DocumentChunk[] = [];
  const emit = (s: Section, content: string) => {
    const head = header(input, s.heading, s.pageOrTimestamp);
    chunks.push({
      index: chunks.length,
      heading: s.heading,
      pageOrTimestamp: s.pageOrTimestamp,
      content,
      text: `${head}\n\n${content}`,
      tokenEstimate: estimateTokens(content),
    });
  };

  for (const section of mergeSmallSections(sections, minTokens, maxTokens)) {
    let parts: string[] = [];
    let tokens = 0;
    let hasNew = false;
    for (const unit of splitUnits(section.text, unitMax)) {
      const t = estimateTokens(unit);
      if (hasNew && tokens + t > maxTokens) {
        const content = parts.join("\n\n");
        emit(section, content);
        const tail = overlapTail(content, overlapRatio);
        parts = tail ? [tail] : [];
        tokens = estimateTokens(tail);
        hasNew = false;
      }
      parts.push(unit);
      tokens += t + 1;
      hasNew = true;
    }
    if (hasNew) emit(section, parts.join("\n\n"));
  }
  return chunks;
}
