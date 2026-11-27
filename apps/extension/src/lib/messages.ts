// Runtime messages between popup / options / content scripts / background.
import { t } from "../i18n";
import type { PageMeta } from "./page-meta";
import type { ApiResult, FileUploadFields, IngestRequest, IngestResponse, ItemStatusInfo } from "./api";
import type { HighlightColor } from "./requests";
import type { SubmitResult } from "./outbox";
import type { SaveSessionResult } from "./sessions";

export type ExtMessage =
  /** -> background: deliver (or queue) an ingest request. */
  | { type: "kortex/ingest"; request: IngestRequest; /** C2 Autosave: show the outcome as a badge on this tab. */ badgeTabId?: number }
  /** -> background: C2 Autosave of a tab (extract, save or queue, badge); survives the popup closing. */
  | { type: "kortex/autosave"; tabId: number }
  /** -> background: pipeline state of a captured item (processed? where was it filed?). */
  | { type: "kortex/status"; itemId: string }
  /** -> background: snooze a saved item (sets remind_at; null clears). */
  | { type: "kortex/remind"; itemId: string; remindAt: string | null }
  /** -> background: retry the queued captures now. */
  | { type: "kortex/flush" }
  /** -> background: drop one queued capture. */
  | { type: "kortex/outbox-remove"; id: string }
  /** -> background: save the (selected) tabs of a window as one session; close them only after the server confirmed. */
  | { type: "kortex/save-session"; windowId: number; tabIds?: number[]; close: boolean; windowName?: string }
  /** -> background: open (or focus) the full-page tab manager. */
  | { type: "kortex/open-manager" }
  /** -> background: "Wiederherstellen" after Speichern & schließen: open these URLs again in the window. */
  | { type: "kortex/reopen-tabs"; windowId: number; urls: string[] }
  /** -> background: close tabs moved into a session (dropped or added through the menu); answers the closed ids. */
  | { type: "kortex/close-tabs"; windowId: number; tabIds: number[] }
  /** -> background: remove a saved highlight on the server (content script "Highlight entfernen"). */
  | { type: "kortex/highlight-delete"; highlightId: string }
  /**
   * background/popup -> content script: save the current text selection as a highlight (context menu, popup mode
   * "Selection"). Answers a `HighlightOutcome`.
   */
  | { type: "kortex/highlight-selection"; fallbackText?: string; color?: HighlightColor; note?: string }
  /** -> background: upload a file (popup screenshot) as multipart to the ingest route; not queued. */
  | { type: "kortex/upload"; dataUrl: string; name: string; fields: FileUploadFields; pageUrl?: string }
  /** content script -> background: open the side panel, optionally with a question about a passage. */
  | { type: "kortex/open-sidepanel"; ask?: AskDraft }
  /** side panel / popup -> content script: what the page has (selection, highlights, readable text). Answers `PageInfo`. */
  | { type: "kortex/page-info"; withText?: boolean }
  /** side panel -> content script: scroll to a highlight and flash it. */
  | { type: "kortex/hl-focus"; id: string };

/** A question started on the page ("Ask" in the selection bar), picked up by the side panel. */
export interface AskDraft {
  url: string;
  title: string;
  quote: string;
  at: number;
}

export interface PageInfo {
  url: string;
  /** The current selection (trimmed), empty when there is none. */
  selection: string;
  /** Readable page text (excerpt), only with `withText`. */
  text?: string;
  /** og:image / twitter:image of the page (the side panel's page card). */
  image?: string;
  /** Highlights shown on the page right now (restored or new). */
  highlights: { id: string; quote: string; note?: string; color?: string; saved: boolean }[];
}

export type HighlightOutcome = { ok: true; text: string } | { ok: false; message: string };

/** Key in chrome.storage.local of a pending question from the page (the side panel takes it once). */
export const ASK_DRAFT_KEY = "askDraft";

export type IngestSender = (request: IngestRequest) => Promise<SubmitResult>;
export type StatusFetcher = (itemId: string) => Promise<ApiResult<ItemStatusInfo>>;
export type RemindSender = (itemId: string, remindAt: string | null) => Promise<ApiResult<{ remind_at: string | null }>>;

export const remindViaBackground: RemindSender = async (itemId, remindAt) => {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "kortex/remind", itemId, remindAt } satisfies ExtMessage)) as
      | ApiResult<{ remind_at: string | null }>
      | undefined;
    return res ?? { ok: false, error: { code: "network", message: t("No answer from the background service") } };
  } catch (e) {
    return { ok: false, error: { code: "network", message: e instanceof Error ? e.message : t("Message failed") } };
  }
};

/** Default sender for extension pages and content scripts. */
export const sendViaBackground: IngestSender = (request) => sendToBackground(request);

/** Autosave sender: the background worker also flashes the outcome on the toolbar badge of `tabId`. */
export const sendWithBadge =
  (tabId: number): IngestSender =>
  (request) =>
    sendToBackground(request, tabId);

async function sendToBackground(request: IngestRequest, badgeTabId?: number): Promise<SubmitResult> {
  try {
    const msg: ExtMessage = badgeTabId === undefined ? { type: "kortex/ingest", request } : { type: "kortex/ingest", request, badgeTabId };
    const res = (await chrome.runtime.sendMessage(msg)) as
      | SubmitResult
      | undefined;
    return res ?? { ok: false, error: { code: "network", message: t("No answer from the background service") } };
  } catch (e) {
    return { ok: false, error: { code: "network", message: e instanceof Error ? e.message : t("Message failed") } };
  }
}

export const fetchStatusViaBackground: StatusFetcher = async (itemId) => {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "kortex/status", itemId } satisfies ExtMessage)) as
      | ApiResult<ItemStatusInfo>
      | undefined;
    return res ?? { ok: false, error: { code: "network", message: t("No answer from the background service") } };
  } catch (e) {
    return { ok: false, error: { code: "network", message: e instanceof Error ? e.message : t("Message failed") } };
  }
};

/** Options page: ask the background worker to act on the queue. */
export const queueCommand = async (msg: Extract<ExtMessage, { type: "kortex/flush" | "kortex/outbox-remove" }>) => {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    /* worker restarting: the 1-minute alarm delivers anyway */
  }
};

/** Side panel: save tabs as a session (the background worker closes them after the server answered). */
export async function saveSessionViaBackground(msg: Omit<Extract<ExtMessage, { type: "kortex/save-session" }>, "type">): Promise<SaveSessionResult> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "kortex/save-session", ...msg } satisfies ExtMessage)) as SaveSessionResult | undefined;
    return res ?? { ok: false, reason: "error", message: t("No answer from the background service") };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : t("Message failed") };
  }
}

export interface AutosaveDone {
  page: PageMeta;
  result: SubmitResult;
}

/** Hands the autosave of `tabId` to the background worker; null when the worker did not answer (popup closed or worker gone). */
export async function autosaveViaBackground(tabId: number): Promise<AutosaveDone | null> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "kortex/autosave", tabId } satisfies ExtMessage)) as AutosaveDone | null | undefined;
    return res ?? null;
  } catch {
    return null;
  }
}

/** Content script: remove a highlight in Kortex (the page item stays). */
export async function deleteHighlightViaBackground(highlightId: string): Promise<ApiResult<{ deleted: true }>> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "kortex/highlight-delete", highlightId } satisfies ExtMessage)) as ApiResult<{ deleted: true }> | undefined;
    return res ?? { ok: false, error: { code: "network", message: t("No answer from the background service") } };
  } catch (e) {
    return { ok: false, error: { code: "network", message: e instanceof Error ? e.message : t("Message failed") } };
  }
}

/** Side panel / popup: open the full-page tab manager (the worker focuses an open one). */
export async function openManagerViaBackground() {
  try {
    await chrome.runtime.sendMessage({ type: "kortex/open-manager" } satisfies ExtMessage);
  } catch {
    /* worker restarting: nothing to do */
  }
}

/** Closes open tabs the safe way (retry, never the last tab of the window, pinned ones stay); returns the closed ids. */
export async function closeTabsViaBackground(windowId: number, tabIds: number[]): Promise<number[]> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "kortex/close-tabs", windowId, tabIds } satisfies ExtMessage)) as number[] | undefined;
    return Array.isArray(res) ? res : [];
  } catch {
    return []; /* worker restarting */
  }
}

/** Undo for "Speichern & schließen": the worker reopens the closed tabs in their window. */
export async function reopenTabsViaBackground(windowId: number, urls: string[]) {
  try {
    await chrome.runtime.sendMessage({ type: "kortex/reopen-tabs", windowId, urls } satisfies ExtMessage);
  } catch {
    /* worker restarting */
  }
}

/** Popup: screenshot upload through the background worker (it owns the API client and the mock inbox). */
export async function uploadViaBackground(msg: Omit<Extract<ExtMessage, { type: "kortex/upload" }>, "type">): Promise<IngestResponse> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "kortex/upload", ...msg } satisfies ExtMessage)) as IngestResponse | undefined;
    return res ?? { ok: false, error: { code: "network", message: t("No answer from the background service") } };
  } catch (e) {
    return { ok: false, error: { code: "network", message: e instanceof Error ? e.message : t("Message failed") } };
  }
}

/** Asks the content script of a tab what the page has; null when no content script answers (store page, PDF, old tab). */
export async function pageInfo(tabId: number, withText = false): Promise<PageInfo | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: "kortex/page-info", withText } satisfies ExtMessage)) as PageInfo | undefined;
    return res && Array.isArray(res.highlights) ? res : null;
  } catch {
    return null;
  }
}

/** Popup mode "Selection": the content script saves its selection as a highlight (colour, note). */
export async function highlightSelectionInTab(tabId: number, opts: { color?: HighlightColor; note?: string } = {}): Promise<HighlightOutcome> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: "kortex/highlight-selection", ...opts } satisfies ExtMessage)) as HighlightOutcome | undefined;
    return res ?? { ok: false, message: t("The page did not answer. Reload it and try again.") };
  } catch {
    return { ok: false, message: t("The page did not answer. Reload it and try again.") };
  }
}

/** Side panel: scroll the page to a highlight. */
export async function focusHighlightInTab(tabId: number, id: string) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "kortex/hl-focus", id } satisfies ExtMessage);
  } catch {
    /* page reloaded meanwhile */
  }
}
