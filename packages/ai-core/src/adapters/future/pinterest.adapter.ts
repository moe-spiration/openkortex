import { NotImplementedAdapterError } from "../../errors";
import type { IngestionAdapter, RawIngestInput } from "../base-adapter";

/** Phase 3 slot: Pinterest pins & boards. Until built, `ingest()` falls back to web-article. */
export function createPinterestAdapter(): IngestionAdapter {
  const id = "pinterest";
  return {
    id,
    canHandle: (input: RawIngestInput) =>
      !!input.url &&
      /^https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?pinterest\.[a-z.]+\/pin\/|^https?:\/\/pin\.it\//i.test(
        input.url,
      ),
    async extract() {
      throw new NotImplementedAdapterError(id);
    },
  };
}
