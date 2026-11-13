/**
 * Pure Markdown <-> block conversion for the Kortex editor (no DOM, no editor instance).
 *
 * Canonical Markdown (what `blocksToMarkdown` emits): ATX headings `#`..`###`, `-` bullets, `1.`
 * ordered lists, `- [ ]` / `- [x]` tasks, `*em*`, `**strong**`, `~~strike~~`, `<u>underline</u>`,
 * `` `code` ``, `[text](url)`, fenced code with language, GFM tables, `![alt](url "caption")` images
 * on their own line, Obsidian callouts (`> [!note] Title` + `> body`), `> [!ai] KI-Zusammenfassung`
 * AI summaries, toggles as Obsidian fold callouts (`> [!toggle]- Title` + `> body blocks`),
 * `[[Title]]` / `[[Title|alias]]` wiki links, `![[Title]]` sub-page embeds, `>` quotes, nested lists
 * (2 spaces for bullets, 3 for ordered), one blank line between blocks, one trailing newline.
 * A leading YAML frontmatter block is split off and re-emitted verbatim. Block-level Markdown the
 * editor can't model becomes a `rawMarkdown` block holding the exact source slice.
 */
import { t } from "@kortex/i18n";
import type * as Mdast from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import {
  toMarkdown,
  type Handle,
  type Join,
  type Options as ToMarkdownOptions,
} from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import { isSafeHref } from "./links";

/* ------------------------------------------------------------------ types */

export interface KortexStyles {
  bold?: true;
  italic?: true;
  strike?: true;
  /** Written as `<u>…</u>` (Markdown has no underline; Obsidian and GitHub render the tag). */
  underline?: true;
  code?: true;
}
export interface KortexText {
  type: "text";
  text: string;
  styles: KortexStyles;
}
export interface KortexLink {
  type: "link";
  href: string;
  content: KortexText[];
}
export interface KortexWikiLink {
  type: "wikiLink";
  props: { target: string; alias: string };
}
export type KortexInline = KortexText | KortexLink | KortexWikiLink;

export type TextAlignment = "left" | "center" | "right" | "justify";
export interface KortexTableCell {
  type: "tableCell";
  props: { textAlignment?: TextAlignment };
  content: KortexInline[];
}
export interface KortexTableContent {
  type: "tableContent";
  headerRows: number;
  rows: { cells: KortexTableCell[] }[];
}

interface BlockBase {
  id?: string;
  children?: KortexPartialBlock[];
}
/** A block as produced by `markdownToBlocks` (a BlockNote `PartialBlock` of the Kortex schema). */
export type KortexPartialBlock = BlockBase &
  (
    | { type: "paragraph"; content: KortexInline[] }
    | { type: "heading"; props: { level: 1 | 2 | 3 }; content: KortexInline[] }
    | { type: "bulletListItem"; content: KortexInline[] }
    | { type: "numberedListItem"; props?: { start?: number }; content: KortexInline[] }
    | { type: "checkListItem"; props: { checked: boolean }; content: KortexInline[] }
    | { type: "quote"; content: KortexInline[] }
    | { type: "codeBlock"; props?: { language?: string; meta?: string }; content: string }
    | { type: "table"; content: KortexTableContent }
    | { type: "image"; props: { url: string; name: string; caption: string } }
    | { type: "divider" }
    | {
        type: "callout";
        props: { kind: string; title: string; fold: string };
        content: KortexInline[];
      }
    | { type: "aiSummary"; props: { title: string }; content: KortexInline[] }
    | {
        /** `> [!toggle]- Title`: title = content, body = children; fold "-" (closed) / "+" / "". */
        type: "toggle";
        props: { fold: string };
        content: KortexInline[];
      }
    | { type: "subpage"; props: { target: string; alias: string } }
    | { type: "rawMarkdown"; content: string }
  );

/**
 * Loose shape accepted by `blocksToMarkdown`: both our partial blocks and BlockNote's
 * `editor.document` blocks (which carry ids and default props) fit.
 */
export interface BlockLike {
  type: string;
  props?: object;
  content?: unknown;
  children?: readonly BlockLike[];
}

/* ------------------------------------------------- custom mdast node types */

interface KxWikiLink extends Mdast.Literal {
  type: "kxWikiLink";
  value: string;
  alias: string;
}
interface KxEmbed extends Mdast.Literal {
  type: "kxEmbed";
  value: string;
  alias: string;
}
interface KxRaw extends Mdast.Literal {
  type: "kxRaw";
}
/** Emitted verbatim, unescaped. */
interface KxLiteral extends Mdast.Literal {
  type: "kxLiteral";
}
interface KxCallout extends Mdast.Parent {
  type: "kxCallout";
  header: string;
  children: Mdast.PhrasingContent[];
}
interface KxUnderline extends Mdast.Parent {
  type: "kxUnderline";
  children: Mdast.PhrasingContent[];
}

declare module "mdast" {
  interface PhrasingContentMap {
    kxWikiLink: KxWikiLink;
    kxLiteral: KxLiteral;
    kxUnderline: KxUnderline;
  }
  interface BlockContentMap {
    kxEmbed: KxEmbed;
    kxRaw: KxRaw;
    kxCallout: KxCallout;
  }
  interface RootContentMap {
    kxWikiLink: KxWikiLink;
    kxLiteral: KxLiteral;
    kxUnderline: KxUnderline;
    kxEmbed: KxEmbed;
    kxRaw: KxRaw;
    kxCallout: KxCallout;
  }
}

/* ------------------------------------------------------------ frontmatter */

/** Splits a leading `---` YAML block (plus the blank lines after it) off the document. */
export function splitFrontmatter(md: string): { frontmatter: string | null; body: string } {
  const open = /^---[ \t]*\r?\n/.exec(md);
  // `---` followed by a blank line is a thematic break, not frontmatter.
  if (!open || /^[ \t]*(\r?\n|$)/.test(md.slice(open[0].length)))
    return { frontmatter: null, body: md };
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  close.lastIndex = open[0].length;
  const m = close.exec(md);
  if (!m) return { frontmatter: null, body: md };
  let end = m.index + m[0].length;
  end += /^(?:[ \t]*\r?\n)*/.exec(md.slice(end))?.[0].length ?? 0;
  return { frontmatter: md.slice(0, end), body: md.slice(end) };
}

/* ------------------------------------------------------- markdown -> blocks */

class Unsupported extends Error {}

interface ParseCtx {
  src: string;
}

const AI_KIND = "ai";
export const TOGGLE_KIND = "toggle";
/**
 * Title a new AI summary block gets, in the user's language. It is written into the Markdown
 * (`> [!ai] KI-Zusammenfassung` / `> [!ai] AI summary`); reading goes by the `[!ai]` kind alone, so
 * existing content with either title (or any other) keeps working.
 */
export const aiSummaryTitle = (): string => t("AI summary");
/**
 * Schema default of the block's `title`: "not set, use the title of the current language". A
 * schema default is fixed at import time, so it cannot be the translated text itself; an explicitly
 * empty title (`> [!ai]`) stays empty.
 */
export const AI_SUMMARY_TITLE_AUTO = "__kx_default__";
const aiTitleOf = (title: string): string => (title === AI_SUMMARY_TITLE_AUTO ? aiSummaryTitle() : title);
const WIKI_RE = /(!?)\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]/g;
const EMBED_RE = /^!\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]$/;
const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)(?:[ \t]+([^\n]*))?(?:\n|$)/;

function slice(node: Mdast.Node, ctx: ParseCtx): string {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  return s === undefined || e === undefined ? "" : ctx.src.slice(s, e);
}

function sameStyles(a: KortexStyles, b: KortexStyles): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strike === !!b.strike &&
    !!a.underline === !!b.underline &&
    !!a.code === !!b.code
  );
}

function pushText(out: KortexInline[], text: string, styles: KortexStyles) {
  if (!text) return;
  const prev = out[out.length - 1];
  if (prev?.type === "text" && sameStyles(prev.styles, styles)) prev.text += text;
  else out.push({ type: "text", text, styles: { ...styles } });
}

/** Text node -> text runs and wiki links. Only `[[...]]` written literally in the source counts. */
function splitWiki(node: Mdast.Text, ctx: ParseCtx, styles: KortexStyles, out: KortexInline[]) {
  const value = node.value;
  // In table cells an alias pipe is written `\|`.
  const source = slice(node, ctx).replace(/\\\|/g, "|") || value;
  let last = 0;
  for (const m of value.matchAll(WIKI_RE)) {
    if (!source.includes(m[0])) continue;
    if (m[1]) throw new Unsupported(); // inline `![[embed]]`
    pushText(out, value.slice(last, m.index), styles);
    out.push({ type: "wikiLink", props: { target: m[2] ?? "", alias: m[3] ?? "" } });
    last = m.index + m[0].length;
  }
  pushText(out, value.slice(last), styles);
}

const U_OPEN = /^<u>$/i;
const U_CLOSE = /^<\/u>$/i;

/** Index of the `</u>` that closes the `<u>` at `open` (same nesting level), or -1. */
function closingU(nodes: readonly Mdast.PhrasingContent[], open: number): number {
  let depth = 0;
  for (let i = open; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.type !== "html") continue;
    if (U_OPEN.test(n.value)) depth++;
    else if (U_CLOSE.test(n.value) && --depth === 0) return i;
  }
  return -1;
}

function inlines(
  nodes: readonly Mdast.PhrasingContent[],
  ctx: ParseCtx,
  styles: KortexStyles = {},
  out: KortexInline[] = [],
): KortexInline[] {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    switch (n.type) {
      case "html": {
        // Only a balanced `<u>…</u>` pair is modelled (underline); other inline HTML stays raw.
        const end = U_OPEN.test(n.value) ? closingU(nodes, i) : -1;
        if (end < 0) throw new Unsupported();
        inlines(nodes.slice(i + 1, end), ctx, { ...styles, underline: true }, out);
        i = end;
        break;
      }
      case "text":
        splitWiki(n, ctx, styles, out);
        break;
      case "emphasis":
        inlines(n.children, ctx, { ...styles, italic: true }, out);
        break;
      case "strong":
        inlines(n.children, ctx, { ...styles, bold: true }, out);
        break;
      case "delete":
        inlines(n.children, ctx, { ...styles, strike: true }, out);
        break;
      case "inlineCode":
        pushText(out, n.value, { ...styles, code: true });
        break;
      case "break":
        pushText(out, "\n", styles);
        break;
      case "link": {
        if (n.title) throw new Unsupported();
        // N5 #24: an unsafe target (javascript:, data:, ...) never becomes a link; the block stays
        // Markdown source text.
        if (!isSafeHref(n.url)) throw new Unsupported();
        const content = inlines(n.children, ctx, styles);
        if (content.some((c) => c.type !== "text")) throw new Unsupported();
        out.push({ type: "link", href: n.url, content: content as KortexText[] });
        break;
      }
      default:
        throw new Unsupported();
    }
  }
  return out;
}

function rawBlock(node: Mdast.Node, ctx: ParseCtx): KortexPartialBlock {
  let text = slice(node, ctx);
  // Nested in a list item: strip the container indentation from continuation lines.
  const indent = (node.position?.start.column ?? 1) - 1;
  if (indent > 0) {
    const re = new RegExp(`^ {0,${indent}}`);
    text = text
      .split("\n")
      .map((l, i) => (i === 0 ? l : l.replace(re, "")))
      .join("\n");
  }
  return { type: "rawMarkdown", content: text };
}

function nested(node: Mdast.RootContent, ctx: ParseCtx): KortexPartialBlock[] {
  try {
    return flow(node, ctx);
  } catch (e) {
    if (e instanceof Unsupported) return [rawBlock(node, ctx)];
    throw e;
  }
}

function paragraph(node: Mdast.Paragraph, ctx: ParseCtx): KortexPartialBlock {
  const [only] = node.children;
  if (node.children.length === 1 && only?.type === "image") {
    return {
      type: "image",
      props: { url: only.url, name: only.alt ?? "", caption: only.title ?? "" },
    };
  }
  if (node.children.length === 1 && only?.type === "text" && slice(only, ctx) === only.value) {
    const m = EMBED_RE.exec(only.value);
    if (m) return { type: "subpage", props: { target: m[1] ?? "", alias: m[2] ?? "" } };
  }
  return { type: "paragraph", content: inlines(node.children, ctx) };
}

/** Source of a block-level node without its list-item indentation (continuation lines). */
function dedented(node: Mdast.Node, ctx: ParseCtx): string {
  const text = slice(node, ctx);
  const indent = (node.position?.start.column ?? 1) - 1;
  if (indent <= 0) return text;
  const re = new RegExp(`^ {0,${indent}}`);
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? l : l.replace(re, "")))
    .join("\n");
}

const parseTree = (src: string) =>
  fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });

/**
 * `> [!toggle]- Title` + body lines. Parsed from the quote's own source (one `>` level removed),
 * so the body is any Markdown (paragraphs, lists, nested toggles ...) and stays exact.
 */
function toggle(node: Mdast.Blockquote, ctx: ParseCtx): KortexPartialBlock | null {
  const inner = dedented(node, ctx)
    .split("\n")
    .map((l) => l.replace(/^ {0,3}> ?/, ""));
  const m = /^\[!toggle\]([+-]?)(?:[ \t]+(.*))?$/i.exec(inner[0] ?? "");
  if (!m) return null;
  const titleSrc = (m[2] ?? "").trimEnd();
  let title: KortexInline[] = [];
  if (titleSrc) {
    const tree = parseTree(titleSrc);
    const [para] = tree.children;
    if (tree.children.length !== 1 || para?.type !== "paragraph") throw new Unsupported();
    title = inlines(para.children, { src: titleSrc });
  }
  const bodySrc = inner.slice(1).join("\n");
  const bodyCtx: ParseCtx = { src: bodySrc };
  const children = parseTree(bodySrc).children.flatMap((c) => nested(c, bodyCtx));
  return {
    type: "toggle",
    props: { fold: m[1] ?? "" },
    content: title,
    ...(children.length ? { children } : {}),
  };
}

function blockquote(node: Mdast.Blockquote, ctx: ParseCtx): KortexPartialBlock {
  if (node.children.length === 0) return { type: "quote", content: [] };
  const [para] = node.children;
  const first = para?.type === "paragraph" ? para.children[0] : undefined;
  if (first?.type === "text" && /^\[!toggle\]/i.test(slice(first, ctx))) {
    const t = toggle(node, ctx);
    if (t) return t;
  }
  if (node.children.length !== 1 || para?.type !== "paragraph") throw new Unsupported();
  const [head, ...rest] = para.children;
  const m =
    head?.type === "text" && slice(head, ctx).startsWith("[!") ? CALLOUT_RE.exec(head.value) : null;
  if (!m || !head || head.type !== "text")
    return { type: "quote", content: inlines(para.children, ctx) };
  // The header line must be plain text (formatting in callout titles isn't modelled).
  if (!m[0].endsWith("\n") && rest.length > 0) throw new Unsupported();
  const body: Mdast.PhrasingContent[] = [
    { ...head, value: head.value.slice(m[0].length) },
    ...rest,
  ];
  const kind = m[1] ?? "note";
  const title = (m[3] ?? "").trimEnd();
  const content = inlines(body, ctx);
  if (kind.toLowerCase() === AI_KIND && !m[2])
    return { type: "aiSummary", props: { title }, content };
  return { type: "callout", props: { kind, title, fold: m[2] ?? "" }, content };
}

function list(node: Mdast.List, ctx: ParseCtx): KortexPartialBlock[] {
  return node.children.map((item, i): KortexPartialBlock => {
    const [first, ...rest] = item.children;
    let childNodes: Mdast.RootContent[] = item.children;
    let content: KortexInline[] = [];
    let checked = typeof item.checked === "boolean" ? item.checked : undefined;
    if (first?.type === "paragraph") {
      // GFM doesn't treat a bare `- [ ]` as a task; we do (it's what an empty to-do serializes to).
      const literal = slice(first, ctx);
      if (checked === undefined && /^\[[ xX]\]$/.test(literal)) checked = literal !== "[ ]";
      else content = inlines(first.children, ctx);
      childNodes = rest;
    }
    const children = childNodes.flatMap((c) => nested(c, ctx));
    const extra = children.length ? { children } : {};
    if (checked !== undefined)
      return { type: "checkListItem", props: { checked }, content, ...extra };
    if (!node.ordered) return { type: "bulletListItem", content, ...extra };
    const start =
      i === 0 && typeof node.start === "number" && node.start !== 1
        ? { props: { start: node.start } }
        : {};
    return { type: "numberedListItem", ...start, content, ...extra };
  });
}

function table(node: Mdast.Table, ctx: ParseCtx): KortexPartialBlock {
  const width = node.children[0]?.children.length ?? 0;
  const align = node.align ?? [];
  return {
    type: "table",
    content: {
      type: "tableContent",
      headerRows: 1,
      rows: node.children.map((row) => ({
        cells: Array.from({ length: width }, (_, ci): KortexTableCell => {
          const a = align[ci];
          return {
            type: "tableCell",
            props: a ? { textAlignment: a } : {},
            content: inlines(row.children[ci]?.children ?? [], ctx),
          };
        }),
      })),
    },
  };
}

function flow(node: Mdast.RootContent, ctx: ParseCtx): KortexPartialBlock[] {
  switch (node.type) {
    case "paragraph":
      return [paragraph(node, ctx)];
    case "heading":
      if (node.depth > 3) throw new Unsupported();
      return [
        {
          type: "heading",
          props: { level: node.depth as 1 | 2 | 3 },
          content: inlines(node.children, ctx),
        },
      ];
    case "thematicBreak":
      return [{ type: "divider" }];
    case "code":
      // Extra info after the language (```ts title="a.ts") is kept as `meta`, never an error.
      return [
        {
          type: "codeBlock",
          ...(node.lang || node.meta
            ? {
                props: {
                  ...(node.lang ? { language: node.lang } : {}),
                  ...(node.meta ? { meta: node.meta } : {}),
                },
              }
            : {}),
          content: node.value,
        },
      ];
    case "blockquote":
      return [blockquote(node, ctx)];
    case "list":
      return list(node, ctx);
    case "table":
      return [table(node, ctx)];
    default:
      throw new Unsupported();
  }
}

/** Parses `content_md` into editor blocks. The frontmatter is returned separately, verbatim. */
export function markdownToBlocks(md: string): {
  frontmatter: string | null;
  blocks: KortexPartialBlock[];
} {
  const { frontmatter, body } = splitFrontmatter(md);
  const src = body.replace(/\r\n?/g, "\n");
  const tree = parseTree(src);
  const ctx: ParseCtx = { src };
  return { frontmatter, blocks: tree.children.flatMap((n) => nested(n, ctx)) };
}

/* ------------------------------------------------------- blocks -> markdown */

type Mark = "bold" | "italic" | "strike" | "underline";
const MARKS: Mark[] = ["bold", "italic", "strike", "underline"];
const MARK_NODE = {
  bold: "strong",
  italic: "emphasis",
  strike: "delete",
  underline: "kxUnderline",
} as const;

type Unit = { text: string; styles: KortexStyles } | { node: Mdast.PhrasingContent };

function prop<T>(b: { props?: object }, key: string, fallback: T): T {
  const v = (b.props as Record<string, unknown> | undefined)?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readStyles(v: unknown): KortexStyles {
  const s = isObj(v) ? v : {};
  const out: KortexStyles = {};
  if (s.bold) out.bold = true;
  if (s.italic) out.italic = true;
  if (s.strike) out.strike = true;
  if (s.underline) out.underline = true;
  if (s.code) out.code = true;
  return out;
}

function keepMarks(styles: KortexStyles, ...neighbours: (Unit | undefined)[]): KortexStyles {
  const out: KortexStyles = styles.code ? { code: true } : {};
  for (const m of MARKS) {
    if (styles[m] && neighbours.every((n) => n && "text" in n && n.styles[m])) out[m] = true;
  }
  return out;
}

/**
 * Moves whitespace at the edge of an emphasis/strong/strike span out of the mark: `**a **` isn't
 * valid Markdown. Whitespace between two runs that share the mark stays inside it.
 */
function trimMarks(units: Unit[]): Unit[] {
  const out: Unit[] = [];
  units.forEach((u, i) => {
    if (!("text" in u) || u.styles.code || !MARKS.some((m) => u.styles[m])) {
      out.push(u);
      return;
    }
    const prev = units[i - 1];
    const next = units[i + 1];
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(u.text);
    const [lead, core, trail] = [m?.[1] ?? "", m?.[2] ?? "", m?.[3] ?? ""];
    if (!core) {
      out.push({ text: u.text, styles: keepMarks(u.styles, prev, next) });
      return;
    }
    if (lead) out.push({ text: lead, styles: keepMarks(u.styles, prev) });
    out.push({ text: core, styles: u.styles });
    if (trail) out.push({ text: trail, styles: keepMarks(u.styles, next) });
  });
  return out;
}

function toUnits(content: unknown): Unit[] {
  const items = typeof content === "string" ? [content] : Array.isArray(content) ? content : [];
  const units: Unit[] = [];
  for (const it of items as unknown[]) {
    if (typeof it === "string") {
      if (it) units.push({ text: it, styles: {} });
    } else if (!isObj(it)) continue;
    else if (it.type === "text") {
      const text = String(it.text ?? "");
      if (text) units.push({ text, styles: readStyles(it.styles) });
    } else if (it.type === "link" && !isSafeHref(String(it.href ?? ""))) {
      // N5 #24: an unsafe link is written as its plain text.
      units.push(...toUnits(it.content));
    } else if (it.type === "link") {
      units.push({
        node: {
          type: "link",
          url: String(it.href ?? ""),
          title: null,
          children: phrasing(toUnits(it.content)),
        },
      });
    } else if (it.type === "wikiLink") {
      const p = isObj(it.props) ? it.props : {};
      const target = String(p.target ?? "");
      if (target)
        units.push({ node: { type: "kxWikiLink", value: target, alias: String(p.alias ?? "") } });
    }
  }
  return trimMarks(units);
}

function isWrapper(
  n: Mdast.PhrasingContent,
): n is Mdast.Strong | Mdast.Emphasis | Mdast.Delete | KxUnderline {
  return (
    n.type === "strong" || n.type === "emphasis" || n.type === "delete" || n.type === "kxUnderline"
  );
}

function mergeSiblings(nodes: Mdast.PhrasingContent[]): Mdast.PhrasingContent[] {
  const out: Mdast.PhrasingContent[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && isWrapper(prev) && isWrapper(n) && prev.type === n.type) {
      prev.children = mergeSiblings([...prev.children, ...n.children]);
    } else if (prev?.type === "text" && n.type === "text") {
      prev.value += n.value;
    } else out.push(n);
  }
  return out;
}

/** Flat styled runs -> nested mdast phrasing. Marks spanning more runs nest outside shorter ones. */
function phrasing(units: Unit[]): Mdast.PhrasingContent[] {
  const has = (i: number, m: Mark) => {
    const u = units[i];
    return !!u && "text" in u && !!u.styles[m];
  };
  const nodes = units.map((u, i): Mdast.PhrasingContent => {
    if ("node" in u) return u.node;
    const marks = MARKS.filter((m) => u.styles[m]).map((m) => {
      let s = i;
      let e = i;
      while (has(s - 1, m)) s--;
      while (has(e + 1, m)) e++;
      return { m, s, e };
    });
    marks.sort((a, b) => a.s - b.s || b.e - a.e || MARKS.indexOf(a.m) - MARKS.indexOf(b.m));
    let node: Mdast.PhrasingContent = u.styles.code
      ? { type: "inlineCode", value: u.text }
      : { type: "text", value: u.text };
    for (let k = marks.length - 1; k >= 0; k--) {
      node = { type: MARK_NODE[marks[k]!.m], children: [node] };
    }
    return node;
  });
  return mergeSiblings(nodes);
}

/**
 * Block content -> phrasing. Whitespace at the block edges and around line breaks is dropped
 * (Markdown ignores it, and to-markdown would otherwise encode it as `&#x20;`).
 */
function inline(content: unknown, flatten = false): Mdast.PhrasingContent[] {
  const units = toUnits(content).filter((u) => {
    if (!("text" in u) || u.styles.code) return true;
    u.text = u.text.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
    if (flatten) u.text = u.text.replace(/\n/g, " ");
    return u.text !== "";
  });
  const trim = (i: number, re: RegExp) => {
    const u = units[i];
    if (!u || !("text" in u) || u.styles.code) return false;
    u.text = u.text.replace(re, "");
    if (u.text) return false;
    units.splice(i, 1);
    return true;
  };
  while (trim(0, /^\s+/));
  while (trim(units.length - 1, /\s+$/));
  return phrasing(units);
}

function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: unknown) => (typeof c === "string" ? c : isObj(c) ? String(c.text ?? "") : ""))
    .join("");
}

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);
/** Blocks whose children have a Markdown form: list items (indented) and toggles (quoted). */
const NESTING_TYPES = new Set([...LIST_TYPES, "toggle"]);

/** Markdown can't nest blocks under paragraphs/headings etc.: their children become following siblings. */
function flattenNonList(blocks: readonly BlockLike[]): BlockLike[] {
  return blocks.flatMap((b) =>
    NESTING_TYPES.has(b.type) || !b.children?.length
      ? [b]
      : [{ ...b, children: [] }, ...flattenNonList(b.children)],
  );
}

function listItem(b: BlockLike): Mdast.ListItem {
  const task = b.type === "checkListItem";
  const para = inline(b.content);
  const checked = task && !!prop(b, "checked", false);
  const item: Mdast.ListItem = {
    type: "listItem",
    spread: false,
    checked: task ? checked : null,
    children: [],
  };
  if (para.length) item.children.push({ type: "paragraph", children: para });
  else if (task) {
    // GFM has no empty task item; write the bare checkbox (read back by `list()`).
    item.checked = null;
    item.children.push({
      type: "paragraph",
      children: [{ type: "kxLiteral", value: checked ? "[x]" : "[ ]" }],
    });
  }
  item.children.push(...(toFlow(b.children ?? []) as Mdast.BlockContent[]));
  return item;
}

function tableNode(content: unknown): Mdast.Table | null {
  if (!isObj(content) || !Array.isArray(content.rows)) return null;
  const rows = (content.rows as unknown[]).map((r) =>
    isObj(r) && Array.isArray(r.cells) ? (r.cells as unknown[]) : [],
  );
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width) return null;
  const cellContent = (c: unknown) => (isObj(c) && c.type === "tableCell" ? c.content : c);
  const align = Array.from({ length: width }, (_, i): Mdast.AlignType => {
    const c = rows[0]?.[i];
    const a = isObj(c) && isObj(c.props) ? c.props.textAlignment : undefined;
    // "left" is BlockNote's default for every cell, so it maps back to "no alignment".
    return a === "center" || a === "right" ? a : null;
  });
  return {
    type: "table",
    align,
    children: rows.map((r) => ({
      type: "tableRow",
      children: Array.from({ length: width }, (_, i) => ({
        type: "tableCell",
        children: inline(cellContent(r[i]), true),
      })),
    })),
  };
}

function blockNode(b: BlockLike): Mdast.RootContent | null {
  switch (b.type) {
    case "paragraph": {
      const children = inline(b.content);
      return children.length ? { type: "paragraph", children } : null;
    }
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(prop(b, "level", 1)))) as 1 | 2 | 3;
      return { type: "heading", depth: level, children: inline(b.content, true) };
    }
    case "quote": {
      const children = inline(b.content);
      return {
        type: "blockquote",
        children: children.length ? [{ type: "paragraph", children }] : [],
      };
    }
    case "codeBlock": {
      const lang = String(prop(b, "language", ""));
      return {
        type: "code",
        lang: lang && lang !== "text" ? lang : null,
        meta: String(prop(b, "meta", "")) || null,
        value: plainText(b.content),
      };
    }
    case "table":
      return tableNode(b.content);
    case "image": {
      const title = String(prop(b, "caption", "")).replace(/\n/g, " ");
      const image: Mdast.Image = {
        type: "image",
        url: String(prop(b, "url", "")),
        alt: String(prop(b, "name", "")),
        title: title || null,
      };
      return { type: "paragraph", children: [image] };
    }
    case "divider":
      return { type: "thematicBreak" };
    case "callout": {
      const kind = String(prop(b, "kind", "note")) || "note";
      const title = String(prop(b, "title", ""));
      const header = `[!${kind}]${String(prop(b, "fold", ""))}${title ? ` ${title}` : ""}`;
      return { type: "kxCallout", header, children: inline(b.content) };
    }
    case "aiSummary": {
      const title = aiTitleOf(String(prop(b, "title", AI_SUMMARY_TITLE_AUTO)));
      return {
        type: "kxCallout",
        header: `[!${AI_KIND}]${title ? ` ${title}` : ""}`,
        children: inline(b.content),
      };
    }
    case "toggle":
      return { type: "kxRaw", value: toggleMarkdown(b) };
    case "subpage": {
      const target = String(prop(b, "target", ""));
      return target
        ? { type: "kxEmbed", value: target, alias: String(prop(b, "alias", "")) }
        : null;
    }
    case "rawMarkdown": {
      const value = plainText(b.content).replace(/\s+$/, "");
      return value.trim() ? { type: "kxRaw", value } : null;
    }
    default:
      return null; // block types without a Markdown form (e.g. not in the schema) are dropped
  }
}

function toFlow(blocks: readonly BlockLike[]): Mdast.RootContent[] {
  const out: Mdast.RootContent[] = [];
  let current: Mdast.List | null = null;
  for (const b of flattenNonList(blocks)) {
    if (LIST_TYPES.has(b.type)) {
      const ordered = b.type === "numberedListItem";
      if (!current || current.ordered !== ordered) {
        const start: number | null = ordered ? Number(prop<unknown>(b, "start", 1)) || 1 : null;
        current = { type: "list", ordered, start, spread: false, children: [] };
        out.push(current);
      }
      current.children.push(listItem(b));
      continue;
    }
    const node = blockNode(b);
    if (!node) continue; // e.g. empty paragraphs: dropped without splitting the surrounding list
    current = null;
    out.push(node);
  }
  return out;
}

const wikiHandle: Handle = (node: KxWikiLink, _parent, state) => {
  const sep = state.stack.includes("tableCell") ? "\\|" : "|";
  return `[[${node.value}${node.alias ? sep + node.alias : ""}]]`;
};

const embedHandle: Handle = (node: KxEmbed) =>
  `![[${node.value}${node.alias ? `|${node.alias}` : ""}]]`;

const rawHandle: Handle = (node: KxRaw | KxLiteral) => node.value;

const underlineHandle: Handle = (node: KxUnderline, _parent, state, info) => {
  const exit = state.enter("emphasis");
  const value = state.containerPhrasing(node, { ...info, before: ">", after: "<" });
  exit();
  return `<u>${value}</u>`;
};

const calloutHandle: Handle = (node: KxCallout, _parent, state) => {
  const exit = state.enter("blockquote");
  const body = state.containerPhrasing(node, {
    before: "\n",
    after: "\n",
    now: { line: 1, column: 1 },
    lineShift: 0,
  });
  exit();
  return [node.header, ...(body ? body.split("\n") : [])]
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
};

/** Tight lists; blank line between all other flow siblings (also inside list items, except before a nested list). */
const joinRule: Join = (_left, right, parent) => {
  if (parent.type === "list") return 0;
  if (parent.type === "listItem") return right.type === "list" ? 0 : 1;
  if (parent.type === "root") return 1;
  return undefined;
};

const TO_MD: ToMarkdownOptions = {
  bullet: "-",
  listItemIndent: "one",
  rule: "-",
  fence: "`",
  fences: true,
  emphasis: "*",
  strong: "*",
  incrementListMarker: true,
  extensions: [gfmToMarkdown({ tablePipeAlign: false })],
  handlers: {
    kxWikiLink: wikiHandle,
    kxEmbed: embedHandle,
    kxRaw: rawHandle,
    kxLiteral: rawHandle,
    kxCallout: calloutHandle,
    kxUnderline: underlineHandle,
  },
  join: [joinRule],
};

/**
 * `> [!toggle]<fold> Title` and the body blocks, each line quoted once. The body starts on the next
 * line when it begins with a paragraph (Obsidian's usual form), after an empty `>` line otherwise
 * (a table or a setext-looking line must not continue the title).
 */
function toggleMarkdown(b: BlockLike): string {
  const fold = String(prop(b, "fold", "-"));
  const titleNodes = inline(b.content, true);
  const title = titleNodes.length
    ? toMarkdown({ type: "root", children: [{ type: "paragraph", children: titleNodes }] }, TO_MD)
        .trim()
        .replace(/\n+/g, " ")
    : "";
  const header = `[!${TOGGLE_KIND}]${fold}${title ? ` ${title}` : ""}`;
  const flow = toFlow(b.children ?? []);
  const body = flow.length
    ? toMarkdown({ type: "root", children: flow }, TO_MD).replace(/\n+$/, "")
    : "";
  const firstLine = body.split("\n")[0] ?? "";
  const compact = flow[0]?.type === "paragraph" && !/^\s*(=+|-+)\s*$/.test(firstLine);
  const lines = body ? [header, ...(compact ? [] : [""]), ...body.split("\n")] : [header];
  return lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
}

/** Serializes editor blocks to canonical Markdown, prefixed with the (verbatim) frontmatter. */
export function blocksToMarkdown(
  blocks: readonly BlockLike[],
  frontmatter?: string | null,
): string {
  const children = toFlow(blocks);
  const body = children.length ? toMarkdown({ type: "root", children }, TO_MD) : "";
  if (!frontmatter) return body;
  if (!body) return frontmatter;
  return frontmatter.endsWith("\n") ? frontmatter + body : `${frontmatter}\n${body}`;
}
