import { NotImplementedAdapterError } from "../../errors";
import { fileExtension, type IngestionAdapter, type RawIngestInput } from "../base-adapter";

/**
 * Phase 4 slot: 1-click Notion / Obsidian / Buildin ZIP importer. File-based importers (Recall
 * Markdown export today) live in `src/importers` (`IMPORTERS`, `runImport`); a ZIP importer unpacks
 * and hands each file to one of them.
 */
export function createWorkspaceImportAdapter(): IngestionAdapter {
  const id = "workspace-import";
  return {
    id,
    canHandle: (input: RawIngestInput) =>
      !!input.fileBuffer &&
      (fileExtension(input) === "zip" ||
        /^application\/(x-)?zip(-compressed)?$/i.test(input.mimeType ?? "")),
    async extract() {
      throw new NotImplementedAdapterError(id, "workspace ZIP import");
    },
  };
}
