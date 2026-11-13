import { normalizeUrl, type KnowledgeItemType } from "@kortex/db";
import { normalizeTag } from "../enrichment/auto-organizer";
import type { ImportedItem, ImporterAdapter } from "./types";

/*
 * Recall export (getrecall.ai, "Export as Markdown"): one .md per card.
 *
 *   ---
 *   title: "AI Memory, Clearly Explained"
 *   tags:
 *     - "Knowledge Management"
 *   createdAt: Wed Aug 12 2026 22:31:53 GMT+0200 (Mitteleuropäische Sommerzeit)
 *   updatedAt: Wed Aug 12 2026 22:31:58 GMT+0200 (Mitteleuropäische Sommerzeit)
 *   ---
 *   Concise summary            <- plain label line, not a heading
 *   ## Topic [(00:00:31)](https://youtube.com/watch?v=..&t=31s)
 *   - bullet with [[Wiki Link|Alias]]
 *   ## Sources
 *   - [website](https://...)   <- 1..n sources; wikipedia_page / website / homepage
 *
 * About two thirds of the cards are entity nodes of Recall's knowledge graph (only `## Sources`,
 * mostly a Wikipedia page) whose single tag names the entity kind ("Person", "Organization/...").
 */

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const SUMMARY_LABEL = /^(concise|detailed|short|long) summary\s*$/i;

/** Minimal YAML for Recall's fixed frontmatter: scalars (quoted or not) and `tags:` lists. */
export function parseRecallFrontmatter(yaml: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let list: string[] | null = null;
  for (const line of yaml.split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && list) {
      const v = unquote(item[1] ?? "");
      if (v) list.push(v);
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv as unknown as [string, string, string];
    if (raw.trim() === "" || raw.trim() === "[]") {
      list = [];
      out[key] = list;
    } else {
      list = null;
      out[key] = unquote(raw);
    }
  }
  return out;
}

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return String(JSON.parse(s));
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
    return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** "Wed Aug 12 2026 22:31:53 GMT+0200 (Mitteleuropäische Sommerzeit)" or ISO → ISO string. */
export function parseRecallDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const m = s.match(
    /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT([+-])(\d{2})(\d{2})$/,
  );
  if (m) {
    const [, mon, d, y, hh, mm, ss, sign, oh, om] = m as unknown as string[];
    const month = MONTHS.indexOf(mon as string);
    if (month < 0) return null;
    const offsetMin = (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om));
    const utc =
      Date.UTC(Number(y), month, Number(d), Number(hh), Number(mm), Number(ss)) -
      offsetMin * 60_000;
    return new Date(utc).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface RecallSource {
  kind: string;
  url: string;
}

/** Entries of the trailing `## Sources` list. */
export function parseRecallSources(section: string): RecallSource[] {
  return [...section.matchAll(/^\s*[-*]\s+\[([^\]]*)\]\((\S+?)\)\s*$/gm)].map((m) => ({
    kind: (m[1] ?? "").trim() || "link",
    url: (m[2] ?? "").trim(),
  }));
}

const host = (url: string | null): string => {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, "");
  } catch {
    return "";
  }
};

/** Recall entity kind (first tag root) → registry type. */
const KIND_TYPES: ReadonlyArray<readonly [RegExp, KnowledgeItemType]> = [
  [/^(person|personality)$/, "person"],
  [/^organization/, "organization"],
  [/^(software application|business software)$/, "tool"],
  [/^(book|business book)$/, "book"],
  [/^movie$/, "movie"],
  [/^podcast/, "podcast"],
  [/^place/, "place"],
  [/^product$/, "product"],
];

/** Type via the registry: media URL first, then Recall's entity tag, else article/bookmark/note. */
export function recallType(
  tags: readonly string[],
  sourceUrl: string | null,
  hasBody: boolean,
): KnowledgeItemType {
  const h = host(sourceUrl);
  if (h === "youtube.com" || h === "youtu.be") return "video";
  if (h === "open.spotify.com" && /\/(episode|show)\//.test(sourceUrl ?? "")) return "podcast";
  for (const tag of tags) {
    const t = tag.trim().toLowerCase();
    const hit = KIND_TYPES.find(([re]) => re.test(t));
    if (hit) return hit[1];
  }
  if (!sourceUrl) return "note";
  return hasBody ? "article" : "bookmark";
}

/** Clean Markdown body: LF, no "Concise summary" label line, at most one blank line in a row. */
export function cleanRecallBody(body: string): string {
  return body
    .split("\n")
    .filter((l) => !SUMMARY_LABEL.test(l.trim()))
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const safeNormalize = (url: string): string | null => {
  try {
    const u = normalizeUrl(url);
    return /^https?:/i.test(u) ? u : null;
  } catch {
    return null;
  }
};

/** Parses one Recall export file into an importable item (pure; throws on a non-Recall file). */
export function parseRecallMarkdown(text: string, file: string): ImportedItem {
  const src = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, "\n");
  const fm = src.match(FRONTMATTER);
  if (!fm) throw new Error(`${file}: no YAML frontmatter`);
  const meta = parseRecallFrontmatter(fm[1] ?? "");
  const body = src.slice(fm[0].length);

  const [main = "", ...rest] = body.split(/^##\s+Sources\s*$/m);
  const sources = parseRecallSources(rest.join("\n"));
  const content = cleanRecallBody(main);
  const hasBody = content.length > 0;

  const urls = sources.map((s) => safeNormalize(s.url)).filter((u): u is string => !!u);
  const sourceUrl = urls[0] ?? null;
  const rawTags = Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [];
  const tags = [...new Set(rawTags.map(normalizeTag).filter(Boolean))];
  const fileTitle = file.replace(/^.*[\\/]/, "").replace(/\.md$/i, "");
  const title = (typeof meta.title === "string" && meta.title.trim()) || fileTitle || "Recall";
  const type = recallType(rawTags, sourceUrl, hasBody);

  const sourcesMd = sources.length
    ? `## Sources\n\n${sources.map((s) => `- [${s.kind}](${s.url})`).join("\n")}`
    : "";
  const contentMd = [content, sourcesMd].filter(Boolean).join("\n\n") + "\n";

  return {
    type,
    title,
    contentMd,
    sourceUrl,
    tags,
    createdAt: parseRecallDate(typeof meta.createdAt === "string" ? meta.createdAt : undefined),
    updatedAt: parseRecallDate(typeof meta.updatedAt === "string" ? meta.updatedAt : undefined),
    hasBody,
    notesMd: content,
    metadata: {
      import: {
        source: "recall",
        file: fileTitle + ".md",
        ...(rawTags.length ? { recall_tags: rawTags } : {}),
        ...(sources.length > 1
          ? { sources: sources.map((s) => ({ kind: s.kind, url: s.url })) }
          : {}),
        ...(sources[0] ? { source_kind: sources[0].kind } : {}),
      },
    },
  };
}

export const recallImporter: ImporterAdapter = {
  id: "recall",
  label: "Recall (Markdown-Export)",
  canHandle: (file, text) =>
    /\.md$/i.test(file) &&
    FRONTMATTER.test(text.replace(/^[^-]{0,3}---/, "---").replace(/\r\n?/g, "\n")) &&
    /^createdAt:\s*\S/m.test(text) &&
    /^title:/m.test(text),
  parse: parseRecallMarkdown,
};
