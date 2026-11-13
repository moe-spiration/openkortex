/** Base class so callers can `instanceof KortexAiError` for all ai-core errors. */
export class KortexAiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Thrown by an adapter whose `canHandle` matched but which found the content is
 * not for it (e.g. a recipe URL without Recipe JSON-LD). `ingest()` then tries
 * the next adapter in priority order.
 */
export class AdapterDeclinedError extends KortexAiError {
  constructor(
    readonly adapterId: string,
    reason: string,
  ) {
    super(`${adapterId} declined: ${reason}`);
  }
}

/** Thrown by adapter slots that exist but are not built yet (adapters/future/*). */
export class NotImplementedAdapterError extends KortexAiError {
  constructor(
    readonly adapterId: string,
    feature = "extraction",
  ) {
    super(`${adapterId}: ${feature} is not implemented yet`);
  }
}

/** The source could not be read (HTTP error, broken file, provider down). */
export class ExtractionError extends KortexAiError {
  constructor(
    readonly adapterId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${adapterId}: ${message}`, options);
  }
}

export class ConfigError extends KortexAiError {}

export class IngestionError extends KortexAiError {
  constructor(
    readonly code: "no_adapter" | "all_adapters_declined" | "invalid_input",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Raised when a request to OpenRouter could not be forced to `data_collection: 'deny'`. */
export class ZeroDataRetentionError extends KortexAiError {}

export class EmbeddingDimensionError extends KortexAiError {}

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Paid media processing (speech-to-text) refused before it starts: over the per-item length cap
 * or the user's remaining daily AI budget. The item is still saved, without a transcript.
 */
export class MediaBudgetError extends KortexAiError {}
