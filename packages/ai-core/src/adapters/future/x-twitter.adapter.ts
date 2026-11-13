import { NotImplementedAdapterError } from "../../errors";
import type { IngestionAdapter, RawIngestInput } from "../base-adapter";

/** Phase 3 slot: X/Twitter threads & bookmarks. Until built, `ingest()` falls back to web-article. */
export function createXTwitterAdapter(): IngestionAdapter {
  const id = "x-twitter";
  return {
    id,
    canHandle: (input: RawIngestInput) =>
      !!input.url &&
      /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i.test(input.url),
    async extract() {
      throw new NotImplementedAdapterError(id);
    },
  };
}
