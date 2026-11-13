import { AdapterDeclinedError, errorMessage, KortexAiError } from "../errors";
import { modelFor, modelIdFor, type ModelRouter } from "../router/model-router";
import { STORAGE_BUCKETS, imageExtension, itemStoragePath, type StorageGateway } from "../storage";
import {
  extractTyped,
  isTypedExtractionType,
  type TypedExtractionType,
} from "../typed/extraction";
import type { ExtractedPayload, IngestionAdapter, RawIngestInput } from "./base-adapter";

const ID = "typed-capture";

export interface TypedCaptureAdapterOptions {
  models: ModelRouter;
  /** Needed for receipt photos (the image is kept in kortex-media). */
  storage?: StorageGateway;
  now?: () => Date;
}

const isImage = (input: RawIngestInput) =>
  !!input.fileBuffer && !!input.mimeType?.toLowerCase().startsWith("image/");

/**
 * Typed capture for the new item types (movie, book, product, place, receipt, snippet,
 * inspiration): the client says what it is (`typeHint`), the model fills the registry fields.
 * Text comes from `rawText`; receipts may also come as a photo (vision). Pages behind a URL are
 * fetched by the web adapters and typed afterwards in `ingest()` (see `reclassify`). Failures
 * decline, so the plain text-note / vision adapters still save the capture.
 */
export function createTypedCaptureAdapter(options: TypedCaptureAdapterOptions): IngestionAdapter {
  return {
    id: ID,
    canHandle(input: RawIngestInput): boolean {
      if (!isTypedExtractionType(input.typeHint)) return false;
      if (input.typeHint === "receipt" && isImage(input)) return true;
      return !input.fileBuffer && (input.rawText?.trim().length ?? 0) > 0;
    },

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const type = input.typeHint as TypedExtractionType;
      const today = (options.now?.() ?? new Date()).toISOString().slice(0, 10);
      const photo = type === "receipt" && isImage(input);

      let file: ExtractedPayload["file"];
      if (photo) {
        if (!input.itemId || !options.storage)
          throw new KortexAiError(`${ID}: itemId and storage are required for receipt photos`);
        const mimeType = (input.mimeType as string).toLowerCase();
        const bytes = input.fileBuffer as Uint8Array;
        const path = itemStoragePath(input.userId, input.itemId, imageExtension(mimeType));
        await options.storage.upload({
          bucket: STORAGE_BUCKETS.media,
          path,
          data: bytes,
          contentType: mimeType,
        });
        file = { bucket: STORAGE_BUCKETS.media, path, mimeType, sizeBytes: bytes.byteLength };
      }

      const task = photo ? "vision_ocr" : "auto_organize";
      let typed;
      try {
        typed = await extractTyped(
          {
            type,
            text: input.rawText ?? "",
            url: input.url,
            titleHint: input.title,
            today,
            ...(photo
              ? {
                  image: {
                    data: input.fileBuffer as Uint8Array,
                    mediaType: (input.mimeType as string).toLowerCase(),
                  },
                }
              : {}),
          },
          { model: modelFor(options.models, task) },
        );
      } catch (cause) {
        throw new AdapterDeclinedError(ID, `typed extraction failed: ${errorMessage(cause)}`);
      }

      return {
        type,
        sourcePlatform: photo ? "upload" : "manual",
        titleHint: typed.title,
        contentMd: typed.contentMd,
        ...(file ? { file } : {}),
        ...(input.url ? { sourceUrl: input.url } : {}),
        metadata: {
          ...typed.metadata,
          typed_by: modelIdFor(options.models, task),
          ...(photo ? { original_file_name: input.fileName ?? null } : {}),
        },
      };
    },
  };
}
