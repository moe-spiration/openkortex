import type { KnowledgeItemType } from "@kortex/db";
import type { RawIngestInput } from "../adapters/base-adapter";

/** One item read from an export file, ready for dedup and insert (no ids, no user). */
export interface ImportedItem {
  type: KnowledgeItemType;
  title: string;
  /** Clean Markdown body. */
  contentMd: string;
  /** Normalised primary source URL (dedup key), null when the file has none. */
  sourceUrl: string | null;
  /** Normalised hierarchical tags (`a/b`). */
  tags: string[];
  /** ISO timestamps from the export, null when missing or unreadable. */
  createdAt: string | null;
  updatedAt: string | null;
  /** False for bare link/entity cards without own text (no AI pipeline needed). */
  hasBody: boolean;
  /** The export's own text without the trailing source list ("" for bare link cards). */
  notesMd?: string;
  /**
   * Content the source already holds (Recall over MCP: the full article or transcript). Goes into
   * the ingest job with the URL, so the pipeline reads it instead of fetching the page.
   */
  prefetched?: Pick<RawIngestInput, "transcript" | "pageContent" | "media" | "imageUrl">;
  /** Always carries `import: { source, file, ... }`. */
  metadata: { import: { source: string; file: string } & Record<string, unknown> } & Record<
    string,
    unknown
  >;
}

/** File-based importer (Recall today; Notion/Obsidian ZIP later, see adapters/future/workspace-import). */
export interface ImporterAdapter {
  id: string;
  label: string;
  canHandle(file: string, text: string): boolean;
  /** Pure: throws when the file is not in the importer's format. */
  parse(text: string, file: string): ImportedItem;
}
