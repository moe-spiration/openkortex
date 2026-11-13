import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { ShareIntent } from "expo-share-intent";
import { isRetryable, requestFromShare, type IngestResponse } from "../api/ingest";
import type { QueueJob } from "../capture/queue";
import { APP_VERSION } from "../api/config";
import { api } from "../api/kortex";

/*
 * Posts what the Android share sheet handed over to /api/ingest (as the signed-in user).
 * A shared link becomes a `web_clip`, text a `note`, a PDF / EPUB / image a multipart `file` upload.
 */

/** queued = Kortex unreachable, kept in the offline queue (text and links only). */
export type ShareStatus = "idle" | "sending" | "done" | "queued" | "error";

export interface ShareIngest {
  status: ShareStatus;
  response: IngestResponse | null;
  /** Human-readable name of what was shared ("hyroxlab.com", "Plan.pdf"). */
  label: string | null;
}

export async function ingestShare(intent: ShareIntent): Promise<IngestResponse | null> {
  const client = api();
  const file = intent.files?.[0];
  if (file) {
    const uri = file.path.startsWith("/") ? `file://${file.path}` : file.path;
    return client.ingestFile({ uri, name: file.fileName, mimeType: file.mimeType });
  }
  const req = requestFromShare({ text: intent.text, webUrl: intent.webUrl, title: intent.meta?.title }, APP_VERSION);
  return req ? client.ingest(req) : null;
}

export function describeShare(intent: ShareIntent): string | null {
  const file = intent.files?.[0];
  if (file) return file.fileName;
  const url = intent.webUrl ?? /https?:\/\/[^\s]+/.exec(intent.text ?? "")?.[0];
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }
  return intent.text?.trim().slice(0, 60) || null;
}

/** Runs the ingest once per received share intent. */
/** Text / link share as an offline-queue job; null for files (their URI may not outlive the share). */
export function shareJob(intent: ShareIntent): QueueJob | null {
  if (intent.files?.length) return null;
  const req = requestFromShare({ text: intent.text, webUrl: intent.webUrl, title: intent.meta?.title }, APP_VERSION);
  return req ? { kind: "ingest", title: describeShare(intent) ?? t("Shared"), req } : null;
}

export function useShareIngest(intent: ShareIntent | null, active: boolean, onOffline?: (job: QueueJob) => Promise<void>): ShareIngest {
  const [state, setState] = useState<ShareIngest>({ status: "idle", response: null, label: null });
  const sent = useRef<ShareIntent | null>(null);

  useEffect(() => {
    if (!active || !intent || sent.current === intent) return;
    sent.current = intent;
    setState({ status: "sending", response: null, label: describeShare(intent) });
    let cancelled = false;
    ingestShare(intent)
      .then(async (response) => {
        const job = shareJob(intent);
        if (response && !response.ok && isRetryable(response) && job && onOffline) {
          await onOffline(job);
          if (!cancelled) setState((s) => ({ ...s, status: "queued", response }));
          return;
        }
        if (!cancelled) setState((s) => ({ ...s, status: response?.ok ? "done" : "error", response }));
      })
      .catch(async () => {
        const job = shareJob(intent);
        if (job && onOffline) {
          await onOffline(job);
          if (!cancelled) setState((s) => ({ ...s, status: "queued", response: null }));
        } else if (!cancelled) setState((s) => ({ ...s, status: "error", response: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [intent, active]);

  return state;
}
