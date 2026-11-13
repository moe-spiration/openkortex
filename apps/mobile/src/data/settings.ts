import { msg, t } from "../i18n";

/*
 * The slice of kortex.user_settings the phone shows (same row the web settings edit). Model routing
 * is read-only here (ADR-06, edited on the web); the auto-organizer switches are written.
 */

export interface MobileSettings {
  ai_routing_config: Record<string, { provider?: string; model_id?: string | null; auto_mode?: string }> | null;
  auto_tag_enabled: boolean;
  auto_cluster_enabled: boolean;
  auto_place_threshold: number;
  locale: string;
  weekly_digest_day: number;
  daily_ai_budget_eur: number;
}

/** Mail an Kortex (GET /api/ingest/mail): the private inbound address, read-only on the phone. */
export interface InboundMail {
  configured: boolean;
  domain: string | null;
  address: string | null;
  rotatedAt: string | null;
}

/** Settings row text for the inbound address. */
export function inboundMailRow(m: InboundMail | null): { help: string; value: string } {
  if (!m) return { help: t("Loading"), value: "–" };
  if (!m.configured) return { help: t("Not set up on the server"), value: t("Off") };
  if (!m.address) return { help: t("Create the address on the web (Settings › Connectors)"), value: t("On the web") };
  return { help: m.address, value: t("Copy") };
}

export const SETTINGS_COLUMNS = "ai_routing_config,auto_tag_enabled,auto_cluster_enabled,auto_place_threshold,locale,weekly_digest_day,daily_ai_budget_eur";

const TASK_LABEL: Record<string, string> = {
  summarize: msg("Summarize"),
  auto_organize: msg("Auto-organization"),
  chat_reasoning: "Chat (Ask AI)",
  meeting_coach: msg("Meeting coach"),
  vision_ocr: msg("Images and OCR"),
  audio_transcription: msg("Voice memos"),
  document_parsing: msg("Documents"),
  embeddings: "Embeddings",
};
const AUTO_LABEL: Record<string, string> = { cost_efficient: msg("low cost"), balanced: msg("balanced"), max_quality: msg("best quality") };
const PROVIDER: Record<string, string> = { anthropic: "Anthropic", openrouter: "OpenRouter", edenai: "Eden AI" };

/** One row per routed task: "Anthropic · Auto (low cost)" or "OpenRouter · <model>". */
export function routingRows(cfg: MobileSettings["ai_routing_config"]): { task: string; label: string; value: string }[] {
  return Object.keys(TASK_LABEL).map((task) => {
    const r = cfg?.[task];
    const provider = r?.provider ? (PROVIDER[r.provider] ?? r.provider) : t("Default");
    const model = r?.model_id ? r.model_id.split("/").pop()! : `Auto${r?.auto_mode ? ` (${AUTO_LABEL[r.auto_mode] ? t(AUTO_LABEL[r.auto_mode]!) : r.auto_mode})` : ""}`;
    return { task, label: t(TASK_LABEL[task]!), value: `${provider} · ${model}` };
  });
}

/** English weekday names, Sunday first (`user_settings.weekly_digest_day`); shown with `t(WEEKDAYS[day])`. */
export const WEEKDAYS = [msg("Sunday"), msg("Monday"), msg("Tuesday"), msg("Wednesday"), msg("Thursday"), msg("Friday"), msg("Saturday")];
