"use client";

import { t, tx } from "@/i18n";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ApiClientError, ingest, ingestStatus, uploadFile, type IngestSuccess } from "@/lib/api/client";
import { requestPlacementReview } from "@/lib/api/actions";
import { isLiveData } from "@/lib/workspace-data";
import {
  iconForFile,
  planFile,
  pollItem,
  shorten,
  stepFor,
  textRequest,
  type CaptureInput,
  type CaptureJob,
  type CaptureStatus,
} from "./capture-core";
import { routeFor } from "./copilot";
import { useShell } from "./store";

export type { CaptureInput, CaptureJob, CaptureStatus } from "./capture-core";

/*
 * Shared capture hook (footbar Festhalten, Ctrl+K quick drop, Inbox drop zone, voice notes).
 *
 *   const { capture, captureData, jobs } = useCapture();
 *   capture({ text: "Idee …" });            // note, or web clip when the text is only a URL
 *   capture({ file });                       // PDF / EPUB / image upload, .md/.txt as note
 *   captureData(event.dataTransfer);         // drop or paste: files, uri-list or plain text
 *
 * Live mode: optimistic job → POST /api/ingest → poll GET /api/ingest?item_id= until processed or
 * error, then refresh the server-rendered views. Mock mode: the job just appears in the inbox.
 * Jobs live in the shell store (`captures`), so they survive navigation and closing the palette.
 */

/** Processed jobs stay visible this long before they leave the "in Arbeit" list. */
const KEEP_DONE_MS = 8000;

let seq = 0;
const newId = () => `cap-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.failure.code === "unauthorized") return t("Not signed in");
    if (err.failure.code === "not_configured") return t("Server not configured");
    if (err.failure.code === "rate_limited") return t("Too many requests, please wait a moment");
    return err.message;
  }
  return err instanceof Error ? err.message : t("Unknown error");
}

export function useCapture() {
  const router = useRouter();
  const { captures, upsertCapture, dismissCapture, showToast } = useShell();

  const set = useCallback(
    (id: string, status: CaptureStatus, patch: Partial<CaptureJob> = {}) =>
      upsertCapture(id, { status, ...stepFor(status, patch.folderPath), ...patch }),
    [upsertCapture],
  );

  /** Sends one request and follows the item until it is processed. */
  const follow = useCallback(
    async (id: string, send: () => Promise<IngestSuccess>) => {
      let res: IngestSuccess;
      try {
        res = await send();
      } catch (err) {
        const error = errorMessage(err);
        set(id, "error", { error, step: t("Error: {error}", { error }) });
        showToast(t("Not saved: {error}", { error }));
        return;
      }
      set(id, res.status === "processed" ? "processed" : "inbox", { itemId: res.item_id, folderPath: res.folder_path });
      if (res.duplicate) showToast(t("Already in the vault, note added"));
      if (!res.queued && res.status !== "inbox" && res.status !== "processing") {
        router.refresh();
        setTimeout(() => dismissCapture(id), KEEP_DONE_MS);
        return;
      }
      try {
        const last = await pollItem(
          async () => (await ingestStatus(res.item_id)).item,
          (item) => {
            const status: CaptureStatus = item.status === "archived" ? "processed" : item.status;
            set(id, status, {
              title: shorten(item.title),
              folderPath: item.folder_path,
              ...(item.error ? { error: item.error, step: t("Error: {error}", { error: item.error }) } : {}),
            });
          },
        );
        if (last?.status === "error") showToast(t("Processing failed: {title}", { title: shorten(last.title, 40) }));
        else if (last?.status === "processed") {
          const title = shorten(last.title, 40);
          if (last.placement?.decision === "review")
            showToast(t("“{title}” is waiting in the Inbox for your review", { title }));
          else if (last.placement?.decision === "auto" && last.item_id) {
            // Zero-setup: filed without asking; "Prüfen" puts it into the Inbox review instead.
            const itemId = last.item_id;
            showToast(t("“{title}” filed in {folder} automatically", { title, folder: last.folder_path ?? "" }), {
              label: tx("verb", "Review"),
              run: () => void requestPlacementReview(itemId).then(() => router.refresh()),
            });
          } else showToast(t("“{title}” filed in {folder}", { title, folder: last.folder_path ?? "" }));
        }
      } catch (err) {
        set(id, "error", { error: errorMessage(err), step: t("Status unknown (connection)") });
      }
      router.refresh();
      setTimeout(() => dismissCapture(id), KEEP_DONE_MS);
    },
    [set, showToast, router, dismissCapture],
  );

  const capture = useCallback(
    async (input: CaptureInput): Promise<string | null> => {
      const id = newId();
      const createdAt = Date.now();

      if ("file" in input) {
        const { file } = input;
        const plan = planFile(file);
        const base = { id, itemId: null, createdAt, title: shorten(file.name), icon: iconForFile(file.name) };
        if (plan.kind === "unsupported") {
          upsertCapture(id, { ...base, status: "error", error: plan.reason, step: plan.reason, pct: 100 });
          showToast(plan.reason);
          setTimeout(() => dismissCapture(id), KEEP_DONE_MS);
          return null;
        }
        if (!isLiveData()) {
          upsertCapture(id, { ...base, status: "inbox", step: t("Reading file"), pct: 12 });
          showToast(t("In the Inbox: {name}", { name: shorten(file.name, 40) }));
          return id;
        }
        upsertCapture(id, { ...base, status: "sending", ...stepFor("sending") });
        if (plan.kind === "text") {
          const text = (await file.text()).trim();
          if (!text) {
            set(id, "error", { error: t("File is empty"), step: t("File is empty") });
            return null;
          }
          const title = file.name.replace(/\.(md|markdown|txt)$/i, "");
          void follow(id, () => ingest(textRequest(text, { title })));
        } else void follow(id, () => uploadFile(file));
        showToast(t("In the Inbox: {name}", { name: shorten(file.name, 40) }));
        return id;
      }

      const text = input.text.trim();
      if (!text) return null;
      const req = textRequest(text, { title: input.title, typeHint: input.typeHint, folderPath: input.folderPath, tags: input.tags, note: input.note });
      const isUrl = req.kind === "web_clip";
      const title = shorten(input.title ?? text);
      const icon = input.typeHint === "voice" ? "mic" : isUrl ? "link" : "i-note";
      if (!isLiveData()) {
        const r = routeFor(text);
        upsertCapture(id, { id, itemId: null, createdAt, title, icon, status: "inbox", step: isUrl ? t("Loading page") : t("Auto-routing: {space}", { space: r.space }), pct: 22 });
        showToast(t("In Inbox · Suggestion: {space} · {tag}", { space: r.space, tag: r.tag }));
        return id;
      }
      upsertCapture(id, { id, itemId: null, createdAt, title, icon, status: "sending", ...stepFor("sending") });
      showToast(isUrl ? t("Link in the Inbox, loading page") : t("In the Inbox, being filed"));
      void follow(id, () => ingest(req));
      return id;
    },
    [upsertCapture, dismissCapture, showToast, set, follow],
  );

  /** Drop or paste: every file, else the first URL list / plain text. Returns how many captures started. */
  const captureData = useCallback(
    (dt: DataTransfer | null): number => {
      if (!dt) return 0;
      const files = Array.from(dt.files ?? []);
      if (files.length) {
        files.forEach((file) => void capture({ file }));
        return files.length;
      }
      const uris = dt
        .getData("text/uri-list")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      const text = uris[0] ?? dt.getData("text/plain").trim();
      if (!text) return 0;
      void capture({ text });
      return 1;
    },
    [capture],
  );

  return { capture, captureData, jobs: captures, dismiss: dismissCapture };
}
