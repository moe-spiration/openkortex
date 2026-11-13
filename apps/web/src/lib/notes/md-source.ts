import type { KnowledgeItem } from "@/lib/workspace-data";
import { splitForDisplay } from "./dedupe";

/*
 * "Markdown-Quelle" (decision 4): the note as its raw vault file, read-only. The frontmatter is built from the
 * item's fields and metadata in the order md-sync writes it (packages/md-sync/src/frontmatter.ts FRONTMATTER_KEYS);
 * the body is content_md verbatim. The parts the view hides (matching H1, leading TL;DR) are returned separately so
 * the panel can mark them.
 */

export interface MarkdownSource {
  /** Vault path of the file. */
  path: string;
  /** `---` … `---` block. */
  frontmatter: string;
  /** Hidden head of the body (H1 / TL;DR), verbatim; "" when the file has none. */
  marked: string;
  /** The rest of the body. */
  rest: string;
}

const PLAIN = /^[\p{L}\p{N}][\p{L}\p{N} _./@+-]*$/u;
const RESERVED = /^(?:true|false|null|yes|no|on|off|~|-?\d[\d.e+-]*)$/i;

/** YAML scalar: plain when that is safe, otherwise a JSON (double-quoted) string. */
export function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  return PLAIN.test(s) && !RESERVED.test(s) && !/[:#]\s|\s$/.test(s) ? s : JSON.stringify(s);
}

function yamlValue(v: unknown, indent: string): string {
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => yamlScalar(x)).join(", ")}]` : "[]";
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return "{}";
    return "\n" + entries.map(([k, x]) => yamlLine(indent + "  ", k, x)).join("\n");
  }
  return yamlScalar(v);
}

/** `key: value`, or `key:` followed by the indented lines of a nested map. */
function yamlLine(indent: string, key: string, v: unknown): string {
  const y = yamlValue(v, indent);
  return `${indent}${yamlKey(key)}:${y.startsWith("\n") ? y : ` ${y}`}`;
}

const yamlKey = (k: string) => (/^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k));

/** Builds the raw file view of a note. */
export function markdownSource(item: KnowledgeItem): MarkdownSource {
  const folder = item.path.split("/").slice(0, -1).join("/");
  const split = splitForDisplay(item.contentMd, { title: item.title, summary: item.tldr });
  // A file that already carries frontmatter in content_md shows it as written.
  const data: [string, unknown][] = [
    ["id", item.id],
    ["title", item.title],
    ["type", item.type],
    ["source_ref", item.source?.url ?? undefined],
    ["folder_path", folder || undefined],
    ["cover_image", item.cover ?? undefined],
    ["tags", item.tags],
    ["status", item.status ?? undefined],
    ["created_at", `${item.date}T${item.time}`],
    ["summary", item.tldr || undefined],
    ["metadata", Object.keys(item.metadata ?? {}).length ? item.metadata : undefined],
  ];
  const frontmatter = split.frontmatter
    ? split.frontmatter.replace(/\r?\n$/, "")
    : ["---", ...data.filter(([, v]) => v !== undefined).map(([k, v]) => yamlLine("", k, v)), "---"].join("\n");
  return { path: item.path, frontmatter, marked: split.hidden, rest: split.body };
}
