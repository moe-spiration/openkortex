import { NodeHtmlMarkdown } from "node-html-markdown";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
};

export const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e] ?? m;
  });

export const stripTags = (s: string): string =>
  decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** Parses `a="1" b='2'` into a map (namespace prefixes kept, e.g. `epub:type`). */
export function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    if (m[1]) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export interface XmlElement {
  attrs: Record<string, string>;
  inner: string;
}

/** Non-nested elements by local name, namespace-tolerant (`dc:title`, `opf:item`). */
export function findElements(xml: string, localName: string): XmlElement[] {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${localName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${localName}\\s*>)`,
    "gi",
  );
  return [...xml.matchAll(re)].map((m) => ({ attrs: parseAttrs(m[1] ?? ""), inner: m[2] ?? "" }));
}

export const firstText = (xml: string, localName: string): string | undefined => {
  const el = findElements(xml, localName)[0];
  const text = el ? stripTags(el.inner) : "";
  return text || undefined;
};

/** Iterates open/close/self-closing tags in order, for small nesting-aware scans. */
export function* scanTags(xml: string): Generator<{
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
  index: number;
  end: number;
}> {
  for (const m of xml.matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>/g)) {
    const name = (m[2] ?? "").replace(/^[\w-]+:/, "").toLowerCase();
    yield {
      name,
      attrs: parseAttrs(m[3] ?? ""),
      closing: m[1] === "/",
      selfClosing: m[4] === "/",
      index: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    };
  }
}

const nhm = new NodeHtmlMarkdown({
  bulletMarker: "-",
  codeBlockStyle: "fenced",
  maxConsecutiveNewlines: 2,
});

/** HTML/XHTML body to clean Markdown. Drops images and links to files inside the package. */
export function htmlToMarkdown(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const cleaned = body
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<image\b[^>]*\/?>/gi, "");
  return nhm
    .translate(cleaned)
    .replace(/\[([^\]]*)\]\((?!https?:|mailto:)[^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Resolves a relative href against a POSIX directory inside a zip. */
export function resolveZipPath(baseDir: string, href: string): string {
  const parts = (baseDir ? `${baseDir}/${href}` : href).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

export const dirname = (path: string): string => path.split("/").slice(0, -1).join("/");
