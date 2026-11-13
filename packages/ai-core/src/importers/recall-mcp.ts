import { normalizeUrl } from "@kortex/db";
import type { ClientTranscript, MediaInfo } from "../adapters/base-adapter";
import { recallType } from "./recall";
import type { ImportedItem, ImporterAdapter } from "./types";

/*
 * Recall over its MCP server (https://backend.getrecall.ai/mcp/, `fetch` tool): unlike the Markdown
 * export, a card there holds the full saved content, the whole article or the timestamped
 * transcript. The import hands that content to the normal URL pipeline (no crawl, no bot walls);
 * title, tags, summary, folder and objects come from Kortex. One "file" per card:
 * `{ file: "recall:<id>", text: JSON.stringify(card) }`, the card being the merged fetch pages.
 */

export interface RecallCard {
  id: string;
  title?: string | null;
  /** Saved content (fetch part "content"), all pages joined. */
  text: string;
  metadata?: {
    source_url?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    tags?: Array<{ name?: string; path?: string } | string>;
    missing_chunks?: number;
    /** Card image (filter_by_metadata `image`): cover candidate. */
    image?: string | null;
  };
}

export const RECALL_MCP_FILE_PREFIX = "recall:";

/** `[(00:01:05)](https://…&t=65)`: Recall's transcript stamp, placed before its text. */
const STAMP = /\[\((\d{1,2}(?::\d{2}){1,2})\)\]\([^)\s]*\)/g;

const seconds = (clock: string): number =>
  clock.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);

/** Content under "## Content" when the card text still has the notes part. */
export function recallContentPart(text: string): string {
  const src = text.replace(/\r\n?/g, "\n");
  const m = src.match(/^## Content\s*$/m);
  return (
    (m ? src.slice((m.index ?? 0) + m[0].length) : src)
      // Recall's own links point at card ids (`[Naval](8f43…)`), not URLs: keep only the text.
      .replace(
        /\[([^\]]*)\]\((?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi,
        "$1",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Timestamped transcript → segments (headings and blank lines dropped). Empty for articles. */
export function recallTranscriptSegments(content: string): ClientTranscript["segments"] {
  const stamps = [...content.matchAll(STAMP)];
  if (stamps.length < 3) return [];
  const out: { start: number; text: string }[] = [];
  stamps.forEach((m, i) => {
    const from = (m.index ?? 0) + m[0].length;
    const to = stamps[i + 1]?.index ?? content.length;
    const text = content
      .slice(from, to)
      .replace(/^#{1,6}\s.*$/gm, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push({ start: seconds(m[1] ?? "0"), text });
  });
  return out;
}

const host = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, "");
  } catch {
    return "";
  }
};

function mediaKind(url: string): MediaInfo["kind"] {
  const h = host(url);
  if (h === "open.spotify.com" || h === "podcasts.apple.com" || /podcast/.test(h)) return "podcast";
  return "video";
}

const tagNames = (tags: NonNullable<RecallCard["metadata"]>["tags"]): string[] =>
  (tags ?? [])
    .map((t) => (typeof t === "string" ? t : (t.path ?? t.name ?? "")).replace(/\s*›\s*/g, "/"))
    .map((t) => t.trim())
    .filter(Boolean);

const safeUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const u = normalizeUrl(url);
    return /^https?:/i.test(u) ? u : null;
  } catch {
    return null;
  }
};

/** One Recall card (MCP fetch) → importable item with its content ready for the pipeline. */
export function parseRecallCard(text: string, file: string): ImportedItem {
  let card: RecallCard;
  try {
    card = JSON.parse(text) as RecallCard;
  } catch {
    throw new Error(`${file}: not a Recall card (JSON expected)`);
  }
  if (!card || typeof card.id !== "string" || typeof card.text !== "string")
    throw new Error(`${file}: Recall card without id or text`);

  const meta = card.metadata ?? {};
  const rawUrl = meta.source_url ?? null;
  const sourceUrl = safeUrl(rawUrl);
  const content = recallContentPart(card.text);
  const hasBody = content.length > 0;
  const recallTags = tagNames(meta.tags);
  const type = recallType(recallTags, sourceUrl, hasBody);
  const title = card.title?.trim() || (sourceUrl ? host(sourceUrl) : "") || "Recall";

  const segments = recallTranscriptSegments(content);
  let prefetched: ImportedItem["prefetched"];
  if (sourceUrl && segments?.length) {
    const h = host(sourceUrl);
    const youtube = h === "youtube.com" || h === "youtu.be";
    prefetched = {
      transcript: {
        text: segments.map((s) => s.text).join(" "),
        source: "page",
        segments,
      },
      // YouTube has its own adapter; other players go to client-media with their kind.
      ...(youtube ? {} : { media: { kind: mediaKind(sourceUrl) } }),
    };
  } else if (sourceUrl && hasBody) {
    prefetched = { pageContent: { markdown: content, title } };
  }
  if (prefetched && meta.image && /^https?:\/\//i.test(meta.image))
    prefetched.imageUrl = meta.image;

  return {
    type,
    title,
    contentMd: (hasBody ? content : sourceUrl ? `[${title}](${sourceUrl})` : title) + "\n",
    sourceUrl,
    // Kortex tags the item itself; Recall's tags stay in metadata.import.
    tags: [],
    createdAt: meta.created_at ?? null,
    updatedAt: meta.updated_at ?? null,
    hasBody,
    notesMd: content,
    ...(prefetched ? { prefetched } : {}),
    metadata: {
      import: {
        source: "recall",
        file: `${RECALL_MCP_FILE_PREFIX}${card.id}`,
        card_id: card.id,
        via: "mcp",
        ...(recallTags.length ? { recall_tags: recallTags } : {}),
        ...(meta.missing_chunks ? { missing_chunks: meta.missing_chunks } : {}),
      },
    },
  };
}

export const recallMcpImporter: ImporterAdapter = {
  id: "recall-mcp",
  label: "Recall (MCP)",
  canHandle: (file, text) =>
    file.startsWith(RECALL_MCP_FILE_PREFIX) && text.trimStart().startsWith("{"),
  parse: parseRecallCard,
};
