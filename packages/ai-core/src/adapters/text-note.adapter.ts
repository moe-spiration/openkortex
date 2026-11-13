import type { ExtractedPayload, IngestionAdapter, RawIngestInput } from "./base-adapter";

/** Lowest-priority catch-all for plain thoughts typed into the inbox. */
export function createTextNoteAdapter(): IngestionAdapter {
  return {
    id: "text-note",
    canHandle: (input: RawIngestInput) =>
      !input.url && !input.fileBuffer && (input.rawText?.trim().length ?? 0) > 0,

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const text = (input.rawText ?? "").replace(/\r\n/g, "\n").trim();
      const firstLine =
        text
          .split("\n", 1)[0]
          ?.replace(/^#+\s*/, "")
          .trim() ?? "";
      return {
        type: input.typeHint ?? "note",
        sourcePlatform: "manual",
        titleHint: firstLine.slice(0, 80) || undefined,
        contentMd: text,
        metadata: {},
      };
    },
  };
}
