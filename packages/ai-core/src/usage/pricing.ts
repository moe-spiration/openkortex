import { intlLocale } from "../i18n";
import type { AiProvider } from "@kortex/db";
import { anthropicListPrice, type CatalogModel } from "../providers/catalog";

/*
 * Cost estimate of one AI call (S2a budget). Prices come from the discovered catalog
 * (kortex.ai_model_catalog.pricing, USD per million tokens); a model without a price is charged a
 * conservative default so an unknown model can never run the budget for free. Shared by the web
 * server, md-sync and the MCP organizer.
 */

export interface TokenPrice {
  input_per_mtok?: number;
  output_per_mtok?: number;
}

/** Fallback prices (USD / 1M tokens) when the catalog has none: deliberately on the high side. */
export const DEFAULT_PRICE: Record<"text" | "embedding", Required<TokenPrice>> = {
  // Top-tier (Opus-class) prices: Anthropic /v1/models has no prices, so Anthropic calls land here.
  text: { input_per_mtok: 15, output_per_mtok: 75 },
  embedding: { input_per_mtok: 0.2, output_per_mtok: 0 },
};

export interface CostEstimate {
  usd: number;
  /** No catalog price: the default was used. */
  estimated: boolean;
}

export function estimateCost(
  tokens: { input: number; output: number },
  price: TokenPrice | null | undefined,
  kind: "text" | "embedding" = "text",
): CostEstimate {
  const known =
    typeof price?.input_per_mtok === "number" || typeof price?.output_per_mtok === "number";
  const p = known ? price! : DEFAULT_PRICE[kind];
  const usd =
    (Math.max(0, tokens.input) * (p.input_per_mtok ?? 0) +
      Math.max(0, tokens.output) * (p.output_per_mtok ?? 0)) /
    1e6;
  return { usd: Math.round(usd * 1e6) / 1e6, estimated: !known };
}

/** AI SDK provider id ("anthropic.messages", "openrouter.chat", "edenai…") → ADR-06 provider. */
export function providerOf(sdkProvider: string | undefined): AiProvider | "unknown" {
  const p = (sdkProvider ?? "").toLowerCase();
  if (p.startsWith("anthropic")) return "anthropic";
  if (p.startsWith("openrouter")) return "openrouter";
  if (p.startsWith("eden")) return "edenai";
  return "unknown";
}

/** AI SDK usage (number or { total }) → plain token counts. */
export function tokenCounts(usage: unknown): { input: number; output: number } {
  const n = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v && typeof v === "object" && typeof (v as { total?: unknown }).total === "number")
      return (v as { total: number }).total;
    return 0;
  };
  const u = (usage ?? {}) as Record<string, unknown>;
  return { input: n(u.inputTokens ?? u.tokens), output: n(u.outputTokens) };
}

/** Catalog price of a model (provider + exact id); Anthropic falls back to its family list price. */
export function tokenPriceOf(
  catalog: readonly CatalogModel[],
  provider: string,
  modelId: string,
): TokenPrice | null {
  const m = catalog.find((c) => c.provider === provider && c.model_id === modelId);
  const p = (m as { pricing?: TokenPrice } | undefined)?.pricing;
  if (p && (typeof p.input_per_mtok === "number" || typeof p.output_per_mtok === "number"))
    return p;
  return provider === "anthropic" ? anthropicListPrice(modelId) : null;
}

/** USD → EUR for the budget (KORTEX_USD_PER_EUR, default 1.08 USD per EUR). */
export function usdToEur(usd: number, usdPerEur = 1.08): number {
  return usd / (usdPerEur > 0 ? usdPerEur : 1.08);
}

export const formatEur = (eur: number): string =>
  new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(eur);
