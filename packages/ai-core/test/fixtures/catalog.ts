import type { AiProvider, ModelCapability, ModelPricing } from "@kortex/db";
import type { CatalogModel } from "../../src/providers/catalog";

// Handwritten catalog for routing tests. Model ids here are fixtures, not product defaults.

export const AT = "2026-10-24T08:00:00.000Z";

export const m = (
  provider: AiProvider,
  model_id: string,
  capabilities: ModelCapability[],
  extra: {
    pricing?: ModelPricing;
    released?: string;
    family?: string;
    dims?: number | null;
    available?: boolean;
  } = {},
): CatalogModel => ({
  provider,
  model_id,
  display_name: model_id,
  capabilities,
  context_length: null,
  embedding_dimensions: extra.dims ?? null,
  pricing: extra.pricing ?? {},
  is_available: extra.available ?? true,
  fetched_at: AT,
  raw: { released_at: extra.released ?? null, family: extra.family ?? null },
});

export const ANTHROPIC_CATALOG: CatalogModel[] = [
  m("anthropic", "fx-haiku-old", ["chat", "vision"], {
    family: "haiku",
    released: "2025-10-15T00:00:00Z",
  }),
  m("anthropic", "fx-haiku-new", ["chat", "vision", "document_parsing"], {
    family: "haiku",
    released: "2026-10-07T00:00:00Z",
  }),
  m("anthropic", "fx-sonnet-new", ["chat", "vision", "document_parsing"], {
    family: "sonnet",
    released: "2026-09-28T00:00:00Z",
  }),
  m("anthropic", "fx-sonnet-old", ["chat", "vision"], {
    family: "sonnet",
    released: "2026-02-17T00:00:00Z",
  }),
  m("anthropic", "fx-opus-new", ["chat", "vision", "document_parsing"], {
    family: "opus",
    released: "2026-09-21T00:00:00Z",
  }),
  m("anthropic", "fx-fable", ["chat", "vision"], {
    family: "fable",
    released: "2026-10-20T00:00:00Z",
  }),
  m("anthropic", "fx-opus-retired", ["chat"], {
    family: "opus",
    released: "2026-10-23T00:00:00Z",
    available: false,
  }),
];

const p = (input: number, output: number): ModelPricing => ({
  input_per_mtok: input,
  output_per_mtok: output,
});

export const OPENROUTER_CATALOG: CatalogModel[] = [
  m("openrouter", "fx/vision-cheap", ["chat", "vision"], {
    pricing: p(0.1, 0.4),
    released: "2026-09-01T00:00:00Z",
  }),
  m("openrouter", "fx/vision-mid", ["chat", "vision"], {
    pricing: p(1, 4),
    released: "2026-08-01T00:00:00Z",
  }),
  m("openrouter", "fx/vision-pro", ["chat", "vision", "document_parsing"], {
    pricing: p(5, 20),
    released: "2026-07-01T00:00:00Z",
  }),
  m("openrouter", "fx/vision-ancient", ["chat", "vision"], {
    pricing: p(0.01, 0.02),
    released: "2023-01-01T00:00:00Z",
  }),
  m("openrouter", "fx/vision-free:free", ["chat", "vision"], {
    pricing: p(0, 0),
    released: "2026-10-01T00:00:00Z",
  }),
  m("openrouter", "openrouter/auto", ["chat", "vision"], { released: "2026-10-01T00:00:00Z" }),
  m("openrouter", "fx/text-only", ["chat"], {
    pricing: p(0.05, 0.1),
    released: "2026-10-01T00:00:00Z",
  }),
  m("openrouter", "fx/emb-1536-cheap", ["embeddings"], {
    pricing: { input_per_mtok: 0.02 },
    dims: 1536,
    released: "2024-01-25T00:00:00Z",
  }),
  m("openrouter", "fx/emb-1536-pricey", ["embeddings"], {
    pricing: { input_per_mtok: 0.13 },
    dims: 1536,
    released: "2024-01-25T00:00:00Z",
  }),
  m("openrouter", "fx/emb-3072", ["embeddings"], {
    pricing: { input_per_mtok: 0.01 },
    dims: 3072,
    released: "2026-01-01T00:00:00Z",
  }),
  m("openrouter", "fx/emb-unknown", ["embeddings"], {
    pricing: { input_per_mtok: 0.001 },
    dims: null,
  }),
];

export const EDEN_CATALOG: CatalogModel[] = [
  m("edenai", "speech_to_text_async/deepgram/fx-nova", ["audio_transcription"], {
    pricing: { per_unit: 0.0000867, unit: "second" },
  }),
  m("edenai", "speech_to_text_async/google", ["audio_transcription"], {
    pricing: { per_unit: 0.0004, unit: "second" },
  }),
  m("edenai", "speech_to_text_async/assembly", ["audio_transcription"], {
    pricing: { per_unit: 0.0002, unit: "second" },
  }),
  m("edenai", "ocr_async/mistral/fx-ocr", ["document_parsing", "ocr"], {
    pricing: { per_unit: 0.002, unit: "page" },
  }),
  m("edenai", "ocr/google", ["ocr"], { pricing: { per_unit: 0.0015, unit: "page" } }),
  m("edenai", "embeddings/openai/1536__fx-ada", ["embeddings"], {
    pricing: { input_per_mtok: 0.1 },
    dims: 1536,
  }),
  m("edenai", "embeddings/mistral/1024__fx-embed", ["embeddings"], {
    pricing: { input_per_mtok: 0.01 },
    dims: 1024,
  }),
  m("edenai", "llm/mistral/fx-small", ["chat"], {
    pricing: p(0.1, 0.3),
    released: "2026-10-10T00:00:00Z",
  }),
];

export const FULL_CATALOG = [...ANTHROPIC_CATALOG, ...OPENROUTER_CATALOG, ...EDEN_CATALOG];
