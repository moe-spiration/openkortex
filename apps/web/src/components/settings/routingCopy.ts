import type { AiProvider, AiTask, AutoMode, ModelCapability, ModelCatalogEntry } from "@kortex/db/routing";
import { intlLocale, msg, t, tn } from "@/i18n";

/*
 * Labels and help texts of the ADR-06 routing UI. No model ids live here. The tables hold the English
 * source (msg); translate where shown: t(copy.kind), t(copy.role), t(TASK_COPY[x].label), t(AUTO_MODE_COPY[m]).
 * Provider names and AUTO_LABEL are names and stay as they are.
 */

export const PROVIDER_COPY: Record<AiProvider, { label: string; kind: string; role: string }> = {
  anthropic: {
    label: "Anthropic",
    kind: msg("Direct"),
    role: msg("Primary for all text tasks: summarizing, organizing, chat and meeting coaching."),
  },
  openrouter: {
    label: "OpenRouter",
    kind: msg("Gateway"),
    role: msg("Vision, OCR, embeddings and alternative LLMs. Every request with data_collection: 'deny'."),
  },
  edenai: {
    label: "Eden AI",
    kind: msg("Gateway"),
    role: msg("Transcription, document parsing and OCR."),
  },
};

export const TASK_COPY: Record<AiTask, { label: string; help: string }> = {
  summarize: { label: msg("Summarize"), help: msg("TL;DR, short versions and weekly digests") },
  auto_organize: { label: msg("Auto-organization"), help: msg("Tags, clusters, entities and action items") },
  chat_reasoning: { label: msg("Chat and research"), help: msg("Copilot with sources (hybrid RAG)") },
  meeting_coach: { label: msg("Meeting coaching"), help: msg("Live prompts in the meeting HUD") },
  vision_ocr: { label: msg("Images and OCR"), help: msg("Screenshots, diagrams and text in images") },
  audio_transcription: { label: msg("Transcription"), help: msg("Meetings and voice notes") },
  document_parsing: { label: msg("Documents"), help: msg("Break down PDF, EPUB and scans") },
  embeddings: { label: msg("Embeddings"), help: msg("Search and connections") },
};

export const AUTO_MODE_COPY: Record<AutoMode, string> = {
  cost_efficient: msg("Cost"),
  balanced: msg("Balanced"),
  max_quality: msg("Max. quality"),
};

export const AUTO_LABEL = "Auto (Best Cost/Performance)";

export const CAPABILITY_COPY: Record<ModelCapability, string> = {
  chat: msg("Text"),
  vision: msg("Vision"),
  ocr: msg("OCR"),
  audio_transcription: msg("Audio"),
  document_parsing: msg("Documents"),
  embeddings: msg("Embeddings"),
};

export const EMBEDDINGS_HINT = msg(
  "Only models with 1536 dimensions: the vector index is fixed to that. Another format would need a migration and a complete re-embedding.",
);

const usd = (v: number) =>
  "$" + v.toLocaleString(intlLocale(), { minimumFractionDigits: v < 0.1 ? 3 : 2, maximumFractionDigits: v < 0.1 ? 4 : 2 });

/** "$3.00 / $15.00 per 1M tokens", "$0.0043 per minute" or null when the catalog has no price. */
export function priceLabel(m: Pick<ModelCatalogEntry, "pricing">): string | null {
  const p = m.pricing ?? {};
  if (p.input_per_mtok != null && p.output_per_mtok != null) return t("{input} / {output} per 1M tokens", { input: usd(p.input_per_mtok), output: usd(p.output_per_mtok) });
  if (p.input_per_mtok != null) return t("{price} per 1M tokens", { price: usd(p.input_per_mtok) });
  if (p.per_unit != null) return t("{price} per {unit}", { price: usd(p.per_unit), unit: p.unit ?? t("unit") });
  return null;
}

/** "200k context" / "1M context". */
export function contextLabel(m: Pick<ModelCatalogEntry, "context_length">): string | null {
  const c = m.context_length;
  if (!c) return null;
  if (c >= 1_000_000) return t("{size}M context", { size: (c / 1_000_000).toLocaleString(intlLocale(), { maximumFractionDigits: 1 }) });
  return t("{size}k context", { size: Math.round(c / 1000) });
}

/** "5 min ago" / "3 h ago" / "2 days ago" / "never". */
export function agoLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return t("never");
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return t("just now");
  if (s < 3600) return t("{n} min ago", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.round(s / 3600) });
  return tn(Math.round(s / 86400), "{n} day ago", "{n} days ago");
}

export const modelName = (m: Pick<ModelCatalogEntry, "display_name" | "model_id">) => m.display_name || m.model_id;
