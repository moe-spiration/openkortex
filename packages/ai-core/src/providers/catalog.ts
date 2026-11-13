import type { ModelCatalogEntry } from "@kortex/db";

/**
 * A catalog entry as discovery produces it. `raw` lands in kortex.ai_model_catalog.raw and keeps
 * what the normalised columns have no place for: release date and model family (used by Auto).
 */
export interface CatalogModel extends ModelCatalogEntry {
  raw?: CatalogRaw;
}

export interface CatalogRaw {
  /** ISO date the provider published the model (Anthropic created_at, OpenRouter created). */
  released_at?: string | null;
  /** Model line where the provider names it (Anthropic: haiku | sonnet | opus | …). */
  family?: string | null;
  [key: string]: unknown;
}

const asRaw = (m: Partial<CatalogModel> & { raw?: unknown }): CatalogRaw =>
  m.raw && typeof m.raw === "object" && !Array.isArray(m.raw) ? (m.raw as CatalogRaw) : {};

export const releasedAt = (m: Partial<CatalogModel>): number => {
  const v = asRaw(m).released_at;
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export const familyOf = (m: Partial<CatalogModel>): string | null => {
  const f = asRaw(m).family;
  return typeof f === "string" && f ? f.toLowerCase() : null;
};

/** One comparable price: mean of input/output per million tokens, else the per-unit price. */
export function priceOf(m: Pick<ModelCatalogEntry, "pricing">): number | null {
  const p = m.pricing ?? {};
  const tok = [p.input_per_mtok, p.output_per_mtok].filter(
    (x): x is number => typeof x === "number",
  );
  if (tok.length) return tok.reduce((a, b) => a + b, 0) / tok.length;
  return typeof p.per_unit === "number" ? p.per_unit : null;
}

/**
 * Anthropic's /v1/models lists no prices. List prices per model family (USD per million tokens),
 * so Auto routing can rank by cost and the S2a budget meters realistic amounts. Unknown or newer
 * generations get their family's price; Opus is priced at its highest list price (conservative).
 */
export function anthropicListPrice(modelId: string): { input_per_mtok: number; output_per_mtok: number } | null {
  const id = modelId.toLowerCase();
  // Generation 5.5 and 5 (Oct 2026 list prices). Haiku 5.5 costs 5x for prompts over 100K tokens;
  // Kortex prompts stay far below (organizer content is capped at 24K characters).
  if (/haiku-5-5/.test(id)) return { input_per_mtok: 0.1, output_per_mtok: 0.5 };
  if (/sonnet-5(-5)?(\b|-|$)/.test(id)) return { input_per_mtok: 2, output_per_mtok: 10 };
  if (/opus-5-5/.test(id)) return { input_per_mtok: 4, output_per_mtok: 20 };
  if (/opus-(5|4-[678])(\b|-|$)/.test(id)) return { input_per_mtok: 5, output_per_mtok: 25 };
  if (id.includes("haiku")) {
    // generation 3 / 3.5 Haiku (ids "…-3-haiku-…", "…-3-5-haiku-…") had lower list prices
    if (/(^|-)3-haiku/.test(id)) return { input_per_mtok: 0.25, output_per_mtok: 1.25 };
    if (/(^|-)3-5-haiku/.test(id)) return { input_per_mtok: 0.8, output_per_mtok: 4 };
    return { input_per_mtok: 1, output_per_mtok: 5 };
  }
  if (id.includes("sonnet")) return { input_per_mtok: 3, output_per_mtok: 15 };
  if (id.includes("opus")) return { input_per_mtok: 15, output_per_mtok: 75 };
  return null;
}

/** USD per token string (OpenRouter style) → USD per million tokens. */
export const perMtok = (perToken: string | number | null | undefined): number | undefined => {
  const n = typeof perToken === "number" ? perToken : perToken ? Number(perToken) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : undefined;
};
