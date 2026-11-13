// Turns what the Kortex server answered into short UI text (clipper, options, toasts).
import { t } from "../i18n";
import type { IngestSuccess, ItemStatusInfo, MediaInfo, Transcript } from "./api";
import type { StatusTone } from "../ui/StatusChip";

export interface Accepted {
  tone: StatusTone;
  headline: string;
  /** Where the item went right now. */
  placement: string;
  /** Extra line for merged / repeated captures. */
  note?: string;
}

/** Answer of `POST /api/ingest`: the item exists already, the AI pipeline may still run. */
export function describeAccepted(res: Pick<IngestSuccess, "auto_routed" | "folder_path" | "duplicate" | "replayed">): Accepted {
  const placement = res.auto_routed
    ? t("Kortex files the entry automatically (for now {folder})", { folder: res.folder_path })
    : t("Filed in {folder}", { folder: res.folder_path });
  if (res.replayed) {
    return { tone: "ok", headline: t("Already arrived"), placement, note: t("This capture was already in Kortex, nothing was saved twice.") };
  }
  if (res.duplicate) {
    return { tone: "ok", headline: t("Merged with existing entry"), placement, note: t("The page was already in Kortex. Hashtags and note were added.") };
  }
  return { tone: "ok", headline: t("Saved to Kortex Inbox"), placement };
}

export interface Pipeline {
  tone: StatusTone;
  label: string;
  detail?: string;
  /** No further change expected: stop polling. */
  final: boolean;
}

/** State of the AI pipeline (`GET /api/ingest?item_id=`). */
export function describePipeline(info: Pick<ItemStatusInfo, "status" | "folder_path" | "error">): Pipeline {
  switch (info.status) {
    case "processed":
    case "archived":
      return { tone: "ok", label: t("Processed"), detail: t("Sorted into {folder}", { folder: info.folder_path }), final: true };
    case "error":
      return {
        tone: "error",
        label: t("Processing failed"),
        detail: info.error
          ? t("{error} The entry is in {folder} anyway.", { error: info.error, folder: info.folder_path })
          : t("The entry is in {folder}.", { folder: info.folder_path }),
        final: true,
      };
    default:
      return { tone: "warn", label: t("Processing"), detail: t("Summary, hashtags and filing are created in the background."), final: false };
  }
}

/** Toast after a highlight: what the server did with it (new page, existing page, repeat) or that it waits in the queue. */
export function describeHighlightSaved(
  res: { delivered: true; response: Pick<IngestSuccess, "auto_routed" | "folder_path" | "duplicate" | "replayed"> } | { delivered: false },
): string {
  if (!res.delivered) return t("Highlight kept, will be delivered automatically");
  const { response: r } = res;
  if (r.replayed) return t("Highlight was already in Kortex");
  if (r.duplicate) return t("Highlight added to the saved page");
  return r.auto_routed
    ? t("Highlight saved to Kortex (page is in {folder} and will be sorted)", { folder: r.folder_path })
    : t("Highlight saved to Kortex ({folder})", { folder: r.folder_path });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function clock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** "Transcript detected (12 min, de)": length from the last caption line, else ~150 words per minute. */
export function transcriptHint(tr: Transcript): string {
  const last = tr.segments?.[tr.segments.length - 1];
  const sec = last ? last.start + (last.dur ?? 0) : (tr.text.split(/\s+/).filter(Boolean).length / 150) * 60;
  const minutes = Math.max(1, Math.round(sec / 60));
  return tr.lang
    ? t("Transcript detected ({minutes} min, {lang})", { minutes, lang: tr.lang })
    : t("Transcript detected ({minutes} min)", { minutes });
}

/** "Kanal · 12:34" under the title of a video/podcast clip. */
export function mediaLine(m: MediaInfo): string {
  return [m.channel, m.duration_sec ? clock(m.duration_sec) : null].filter(Boolean).join(" · ");
}
