import { recallImporter } from "./recall";
import { recallMcpImporter } from "./recall-mcp";
import type { ImporterAdapter } from "./types";

export * from "./types";
export * from "./recall";
export * from "./recall-mcp";
export * from "./run";

/** File importers by id (`recall`; the Notion/Obsidian ZIP slot lives in adapters/future). */
export const IMPORTERS: Readonly<Record<string, ImporterAdapter>> = {
  recall: recallImporter,
  "recall-mcp": recallMcpImporter,
};

/** Importer for a file: by id, or the first one whose format check accepts the file. */
export function resolveImporter(file: string, text: string, id?: string): ImporterAdapter | null {
  if (id) return IMPORTERS[id] ?? null;
  return Object.values(IMPORTERS).find((i) => i.canHandle(file, text)) ?? null;
}
