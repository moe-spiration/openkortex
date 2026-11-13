import { t } from "../i18n";
import { PROVIDER_KEY_ENV } from "../router/auto-select";
import {
  EMBEDDING_DIMENSIONS,
  type AiProvider,
  type ModelCapability,
  type ModelPricing,
} from "@kortex/db";
import { ConfigError } from "../errors";
import { defaultFetch, requestJson, type FetchLike } from "../http";
import { enforceZeroDataRetention, OPENROUTER_BASE_URL } from "../router/model-router";
import { anthropicListPrice, perMtok, type CatalogModel } from "./catalog";
import { EDENAI_API, EDENAI_LLM_API, edenModelId, type EdenKind } from "./edenai";
import { providerKeys } from "./keys";

// ADR-06 model discovery: list each provider's models and normalise them for
// kortex.ai_model_catalog (capabilities, USD prices, embedding dimensions, release date in raw).
// Keys never go into URLs or log lines.

export const ANTHROPIC_API = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2023-06-01";

export interface DiscoveryOptions {
  env: Record<string, string | undefined>;
  fetch?: FetchLike;
  signal?: AbortSignal;
  now?: () => Date;
  /**
   * OpenRouter does not publish embedding sizes: send a one-word embedding with
   * `dimensions: 1536` to each paid embedding model (fractions of a cent) to find the ones that
   * can serve the 1536-dim embeddings task. Default true.
   */
  probeEmbeddings?: boolean;
}

const iso = (unixSec: number | null | undefined) =>
  typeof unixSec === "number" && unixSec > 0 ? new Date(unixSec * 1000).toISOString() : null;

const entry = (
  provider: AiProvider,
  at: string,
  m: Omit<CatalogModel, "provider" | "fetched_at" | "is_available"> & { is_available?: boolean },
): CatalogModel => ({ provider, fetched_at: at, is_available: m.is_available ?? true, ...m });

// --- Anthropic ----------------------------------------------------------------------------

interface AnthropicModel {
  id: string;
  display_name?: string;
  created_at?: string;
  line?: string;
  max_input_tokens?: number;
  capabilities?: Record<string, { supported?: boolean } | boolean | undefined>;
  lifecycle?: string;
  retires_at?: string | null;
}

const supported = (c: AnthropicModel["capabilities"], key: string) => {
  const v = c?.[key];
  if (v === undefined) return true; // older listings carry no capability block; Claude 3+ reads images and PDFs
  return typeof v === "boolean" ? v : v.supported !== false;
};

export async function discoverAnthropic(o: DiscoveryOptions): Promise<CatalogModel[]> {
  const key = providerKeys(o.env).anthropic;
  if (!key) throw new ConfigError(t("{key} is not set", { key: PROVIDER_KEY_ENV.anthropic }));
  const fetchFn = o.fetch ?? defaultFetch;
  const at = (o.now?.() ?? new Date()).toISOString();
  const out: CatalogModel[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: "1000", ...(after ? { after_id: after } : {}) });
    const res = await requestJson<{
      data?: AnthropicModel[];
      has_more?: boolean;
      last_id?: string;
    }>(fetchFn, "anthropic", `${ANTHROPIC_API}/models?${q}`, {
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      ...(o.signal ? { signal: o.signal } : {}),
    });
    for (const m of res.data ?? []) {
      const caps: ModelCapability[] = ["chat"];
      if (supported(m.capabilities, "image_input")) caps.push("vision");
      if (supported(m.capabilities, "pdf_input")) caps.push("document_parsing");
      const retired =
        m.lifecycle === "retired" ||
        (m.retires_at ? Date.parse(m.retires_at) < Date.parse(at) : false);
      out.push(
        entry("anthropic", at, {
          model_id: m.id,
          display_name: m.display_name ?? m.id,
          capabilities: caps,
          context_length: m.max_input_tokens ?? null,
          embedding_dimensions: null,
          // /v1/models has no prices: list price per family (catalog.ts anthropicListPrice).
          pricing: anthropicListPrice(m.id) ?? {},
          is_available: !retired,
          raw: {
            pricing_source: anthropicListPrice(m.id) ? "list_price" : null,
            released_at: m.created_at ?? null,
            family: m.line ?? null,
            lifecycle: m.lifecycle ?? null,
          },
        }),
      );
    }
    if (!res.has_more || !res.last_id) break;
    after = res.last_id;
  }
  return out;
}

// --- OpenRouter ---------------------------------------------------------------------------

interface OpenRouterModel {
  id: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number | null;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  expiration_date?: string | null;
}

const orPricing = (p: OpenRouterModel["pricing"]): ModelPricing => {
  const input = perMtok(p?.prompt);
  const output = perMtok(p?.completion);
  return {
    ...(input !== undefined ? { input_per_mtok: input } : {}),
    ...(output !== undefined ? { output_per_mtok: output } : {}),
  };
};

/** "768-dim", "1024 dimensional", "3072-dimension" in a model description. */
export const describedDimensions = (text: string | undefined): number | null => {
  const m = text?.match(/(\d{3,4})\s*-?\s*dim(?:ension(?:al|s)?)?\b/i);
  return m?.[1] ? Number(m[1]) : null;
};

async function probeDimensions(
  fetchFn: FetchLike,
  key: string,
  model: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const res = await requestJson<{ data?: Array<{ embedding?: number[] }> }>(
      fetchFn,
      "openrouter",
      `${OPENROUTER_BASE_URL}/embeddings`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: "dimension probe", dimensions: EMBEDDING_DIMENSIONS }),
        timeoutMs: 30_000,
        ...(signal ? { signal } : {}),
      },
    );
    const len = res.data?.[0]?.embedding?.length;
    return typeof len === "number" && len > 0 ? len : null;
  } catch {
    return null;
  }
}

export async function discoverOpenRouter(o: DiscoveryOptions): Promise<CatalogModel[]> {
  const key = providerKeys(o.env).openrouter;
  if (!key) throw new ConfigError(t("{key} is not set", { key: "OPENROUTER_API_KEY" }));
  // Every OpenRouter request (including the dimension probes) carries data_collection: 'deny'.
  const fetchFn = enforceZeroDataRetention(o.fetch ?? defaultFetch);
  const at = (o.now?.() ?? new Date()).toISOString();
  const headers = { Authorization: `Bearer ${key}` };
  const sig = o.signal ? { signal: o.signal } : {};
  const [models, embeddings] = await Promise.all([
    requestJson<{ data?: OpenRouterModel[] }>(
      fetchFn,
      "openrouter",
      `${OPENROUTER_BASE_URL}/models`,
      { headers, ...sig },
    ),
    requestJson<{ data?: OpenRouterModel[] }>(
      fetchFn,
      "openrouter",
      `${OPENROUTER_BASE_URL}/embeddings/models`,
      { headers, ...sig },
    ).catch(() => ({ data: [] as OpenRouterModel[] })),
  ]);
  const expired = (m: OpenRouterModel) =>
    m.expiration_date ? Date.parse(m.expiration_date) < Date.parse(at) : false;

  const out: CatalogModel[] = [];
  for (const m of models.data ?? []) {
    const input = m.architecture?.input_modalities ?? [];
    const output = m.architecture?.output_modalities ?? [];
    if (!output.includes("text") || !input.includes("text")) continue;
    const caps: ModelCapability[] = ["chat"];
    if (input.includes("image")) caps.push("vision");
    if (input.includes("file")) caps.push("document_parsing");
    if (input.includes("audio")) caps.push("audio_transcription");
    out.push(
      entry("openrouter", at, {
        model_id: m.id,
        display_name: m.name ?? m.id,
        capabilities: caps,
        context_length: m.context_length ?? null,
        embedding_dimensions: null,
        pricing: orPricing(m.pricing),
        is_available: !expired(m),
        raw: { released_at: iso(m.created) },
      }),
    );
  }

  const embModels = (embeddings.data ?? []).filter((m) => !expired(m));
  const dims = new Map<string, number | null>();
  for (const m of embModels) dims.set(m.id, describedDimensions(m.description));
  if (o.probeEmbeddings !== false) {
    // Probe only paid models whose description does not already rule them out.
    const toProbe = embModels.filter(
      (m) =>
        !m.id.endsWith(":free") && (dims.get(m.id) ?? EMBEDDING_DIMENSIONS) >= EMBEDDING_DIMENSIONS,
    );
    for (let i = 0; i < toProbe.length; i += 4) {
      await Promise.all(
        toProbe.slice(i, i + 4).map(async (m) => {
          const probed = await probeDimensions(fetchFn, key, m.id, o.signal);
          if (probed !== null) dims.set(m.id, probed);
        }),
      );
    }
  }
  for (const m of embModels) {
    out.push(
      entry("openrouter", at, {
        model_id: m.id,
        display_name: m.name ?? m.id,
        capabilities: ["embeddings"],
        context_length: m.context_length ?? null,
        embedding_dimensions: dims.get(m.id) ?? null,
        pricing: orPricing(m.pricing),
        raw: {
          released_at: iso(m.created),
          dimensions_source: o.probeEmbeddings === false ? "description" : "probe",
        },
      }),
    );
  }
  return out;
}

// --- Eden AI --------------------------------------------------------------------------------

interface EdenPricing {
  model_name?: string;
  price?: string;
  price_unit_quantity?: number;
  price_unit_type?: string;
}

interface EdenSubfeature {
  name: string;
  is_working?: boolean;
  provider?: { name?: string; fullname?: string };
  feature?: { name?: string };
  subfeature?: { name?: string; fullname?: string };
  pricings?: EdenPricing[];
  models?: { models?: string[]; default_model?: string | null };
  llm_details?: Record<
    string,
    { input_cost_per_token?: number; output_cost_per_token?: number; output_vector_size?: number }
  >;
}

interface EdenLlm {
  id: string;
  created?: number;
  context_length?: number | null;
  capabilities?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { input_cost_per_token?: number; output_cost_per_token?: number };
}

const EDEN_FEATURES: Record<string, { kind: EdenKind; caps: ModelCapability[] }> = {
  "audio/speech_to_text_async": { kind: "speech_to_text_async", caps: ["audio_transcription"] },
  "ocr/ocr": { kind: "ocr", caps: ["ocr"] },
  "ocr/ocr_async": { kind: "ocr_async", caps: ["document_parsing", "ocr"] },
  "text/embeddings": { kind: "embeddings", caps: ["embeddings"] },
};

const UNIT: Record<string, string> = {
  seconde: "second",
  second: "second",
  page: "page",
  file: "file",
  token: "token",
  char: "character",
};

function edenPricing(s: EdenSubfeature, model: string | undefined): ModelPricing {
  const llm = model ? s.llm_details?.[model] : undefined;
  if (llm?.input_cost_per_token && (s.feature?.name === "text" || s.feature?.name === "llm")) {
    return { input_per_mtok: Math.round(llm.input_cost_per_token * 1e12) / 1e6 };
  }
  const p =
    s.pricings?.find((x) => x.model_name === model) ??
    s.pricings?.find((x) => x.model_name === "default") ??
    s.pricings?.[0];
  const price = Number(p?.price);
  const qty = p?.price_unit_quantity || 1;
  if (!Number.isFinite(price) || price <= 0) return {};
  const unit = UNIT[p?.price_unit_type ?? ""] ?? p?.price_unit_type ?? "unit";
  if (unit === "token") return { input_per_mtok: Math.round((price / qty) * 1e12) / 1e6 };
  return { per_unit: price / qty, unit };
}

/** 1536 from llm_details.output_vector_size or a "1536__model" name. */
const edenDimensions = (s: EdenSubfeature, model: string | undefined): number | null => {
  const fromDetails = model ? s.llm_details?.[model]?.output_vector_size : undefined;
  if (typeof fromDetails === "number") return fromDetails;
  const m = model?.match(/^(\d{3,4})__/);
  return m?.[1] ? Number(m[1]) : null;
};

export async function discoverEdenAi(o: DiscoveryOptions): Promise<CatalogModel[]> {
  const key = providerKeys(o.env).edenai;
  if (!key) throw new ConfigError(t("{key} is not set", { key: "EDENAI_API_KEY" }));
  const fetchFn = o.fetch ?? defaultFetch;
  const at = (o.now?.() ?? new Date()).toISOString();
  const sig = o.signal ? { signal: o.signal } : {};
  // The v2 feature listing is public (it rejects bearer tokens); the v3 LLM list needs the key.
  const [subfeatures, llms] = await Promise.all([
    requestJson<EdenSubfeature[]>(fetchFn, "edenai", `${EDENAI_API}/info/provider_subfeatures`, {
      ...sig,
    }),
    requestJson<{ data?: EdenLlm[] }>(
      fetchFn,
      "edenai",
      `${EDENAI_LLM_API.replace(/\/llm$/, "")}/models`,
      {
        headers: { Authorization: `Bearer ${key}` },
        ...sig,
      },
    ).catch(() => ({ data: [] as EdenLlm[] })),
  ]);

  const out: CatalogModel[] = [];
  for (const s of subfeatures) {
    const feature = EDEN_FEATURES[`${s.feature?.name}/${s.subfeature?.name}`];
    const provider = s.provider?.name;
    if (!feature || !provider) continue;
    const models = s.models?.models?.length ? s.models.models : [undefined];
    for (const model of models) {
      const isEmb = feature.kind === "embeddings";
      out.push(
        entry("edenai", at, {
          model_id: edenModelId({ kind: feature.kind, provider, ...(model ? { model } : {}) }),
          display_name: `${s.provider?.fullname ?? provider}${model ? ` ${model}` : ""} (${s.subfeature?.fullname ?? s.subfeature?.name})`,
          capabilities: feature.caps,
          context_length: null,
          embedding_dimensions: isEmb ? edenDimensions(s, model) : null,
          pricing: edenPricing(s, model),
          is_available: s.is_working !== false,
          raw: { feature: s.name, default_model: s.models?.default_model ?? null },
        }),
      );
    }
  }
  for (const m of llms.data ?? []) {
    const input = m.capabilities?.input_modalities ?? [];
    const output = m.capabilities?.output_modalities ?? [];
    if (!output.includes("text") || !input.includes("text") || !m.id.includes("/")) continue;
    const caps: ModelCapability[] = ["chat"];
    // No document_parsing here: Eden AI's OCR features serve it (priced per page, not per token).
    if (input.includes("image")) caps.push("vision");
    const inp = perMtok(m.pricing?.input_cost_per_token);
    const outp = perMtok(m.pricing?.output_cost_per_token);
    out.push(
      entry("edenai", at, {
        model_id: `llm/${m.id}`,
        display_name: m.id,
        capabilities: caps,
        context_length: m.context_length ?? null,
        embedding_dimensions: null,
        pricing: {
          ...(inp !== undefined ? { input_per_mtok: inp } : {}),
          ...(outp !== undefined ? { output_per_mtok: outp } : {}),
        },
        raw: { released_at: iso(m.created) },
      }),
    );
  }
  return out;
}

/** Live model listing of one provider, normalised for kortex.ai_model_catalog. */
export function discoverModels(
  provider: AiProvider,
  options: DiscoveryOptions,
): Promise<CatalogModel[]> {
  switch (provider) {
    case "anthropic":
      return discoverAnthropic(options);
    case "openrouter":
      return discoverOpenRouter(options);
    case "edenai":
      return discoverEdenAi(options);
  }
}
