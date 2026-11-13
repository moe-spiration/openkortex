import { intlLocale, t } from "@/i18n";
import {
  MediaBudgetError,
  type CatalogModel,
  type ModelRouter,
  type TranscribeEstimate,
} from "@kortex/ai-core";
import type { ServerDeps } from "../deps";
import { budgetStatus } from "../limits";
import { usdToEur } from "../limits/pricing";

/*
 * Cost guard before paid speech-to-text of long media (podcasts, audio URLs). Refuses with a clear
 * reason when the episode is longer than the user's per-item cap (user_settings.media_max_minutes,
 * 0 = never) or would cost more than what is left of today's AI budget (S2a). The item is saved
 * anyway, without a transcript, and the reason shows in it.
 */

/** Fallback price when the catalog has none for the routed model (Eden AI async STT ≈ this). */
export const DEFAULT_STT_USD_PER_SEC = 0.0002;
/** Bytes per second assumed when only the file size is known (128 kbit/s MP3). */
const BYTES_PER_SEC = 16_000;

const minutes = (sec: number) => Math.round(sec / 60);
const eur = (v: number) =>
  v.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Length of an audio file from its Content-Length (HEAD), or null. */
async function sizeBasedDuration(url: string, fetchFn: typeof fetch): Promise<number | null> {
  try {
    const r = await fetchFn(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const len = Number(r.headers.get("content-length") ?? 0);
    return len > 0 ? Math.round(len / BYTES_PER_SEC) : null;
  } catch {
    return null;
  }
}

/** USD per second of the routed audio_transcription model (catalog price per second). */
export function sttPricePerSecond(models: ModelRouter, catalog: readonly CatalogModel[]): number {
  try {
    const route = models.route?.("audio_transcription");
    const m = route
      ? catalog.find((c) => c.provider === route.provider && c.model_id === route.modelId)
      : undefined;
    const p = m?.pricing as { per_unit?: number; unit?: string } | undefined;
    return p?.per_unit && p.unit === "second" ? p.per_unit : DEFAULT_STT_USD_PER_SEC;
  } catch {
    return DEFAULT_STT_USD_PER_SEC;
  }
}

export function createMediaGuard(o: {
  deps: Pick<ServerDeps, "clients" | "env" | "log" | "now">;
  userId: string;
  /** user_settings.media_max_minutes */
  maxMinutes: number;
  usdPerSec: number;
  fetch?: typeof fetch;
}): (estimate: TranscribeEstimate) => Promise<void> {
  return async (est) => {
    if (o.maxMinutes <= 0)
      throw new MediaBudgetError(
        t("Automatic transcription is switched off (Settings: Media, max. minutes = 0)."),
      );
    const sec = est.durationSec ?? (await sizeBasedDuration(est.audioUrl, o.fetch ?? fetch));
    if (sec !== null && sec > o.maxMinutes * 60)
      throw new MediaBudgetError(
        t("The episode is {minutes} minutes long, Kortex transcribes automatically up to {max} minutes per entry (Settings).", { minutes: minutes(sec), max: o.maxMinutes }),
      );
    const costEur = usdToEur(
      (sec ?? o.maxMinutes * 60) * o.usdPerSec,
      Number(o.deps.env.raw.KORTEX_USD_PER_EUR) || undefined,
    );
    const budget = await budgetStatus(o.deps, o.userId).catch(() => null);
    if (budget && costEur > budget.remainingEur)
      throw new MediaBudgetError(
        t("The transcription would cost about {cost} €, {left} € of today's AI budget are left.", { cost: eur(costEur), left: eur(Math.max(0, budget.remainingEur)) }),
      );
  };
}
