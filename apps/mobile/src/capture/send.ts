import { api, NothingHeardError, transcribe } from "../api/kortex";
import { APP_VERSION } from "../api/config";
import { clientInfo, isRetryable, type IngestRequest } from "../api/ingest";
import { t } from "../i18n";
import { isNetworkError, type QueueJob, type SendResult } from "./queue";
import { VOICE_MIME } from "./useVoice";

/*
 * Sends one capture to Kortex. Shared by the app (Inbox cards, offline queue) and the quick overlay that the
 * home screen widgets open. Tells "try later" (offline) apart from permanent failures.
 */

export interface SendOutcome {
  result: SendResult;
  duplicate?: boolean;
  error?: string;
  nothingHeard?: boolean;
}

export async function sendCapture(job: QueueJob, onStep?: (s: string) => void): Promise<SendOutcome> {
  try {
    let req: IngestRequest;
    if (job.kind === "voice") {
      const text = await transcribe(job.uri, VOICE_MIME);
      onStep?.(t("Saving"));
      req = {
        kind: "note",
        client: clientInfo(APP_VERSION),
        captured_at: new Date().toISOString(),
        content_md: text,
        title: text.split(/\s+/).slice(0, 8).join(" ").slice(0, 80) || job.title,
        type_hint: "voice",
      };
    } else if (job.kind === "file") {
      const r = await api().ingestFile({ uri: job.uri, name: job.name, mimeType: job.mimeType }, { title: job.title, ...(job.note ? { note: job.note } : {}) });
      if (r.ok) return { result: "ok", duplicate: r.duplicate };
      return { result: isRetryable(r) ? "retry" : "drop", error: r.error.message };
    } else req = job.req;
    const r = await api().ingest(req);
    if (r.ok) return { result: "ok", duplicate: r.duplicate };
    return { result: isRetryable(r) ? "retry" : "drop", error: r.error.message };
  } catch (e) {
    if (e instanceof NothingHeardError) return { result: "drop", error: e.message, nothingHeard: true };
    return { result: isNetworkError(e) ? "retry" : "drop", error: e instanceof Error ? e.message : String(e) };
  }
}
