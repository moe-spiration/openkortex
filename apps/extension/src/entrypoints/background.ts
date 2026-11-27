import { initLanguage, t, tx, watchLanguage } from "../i18n";
import { appendActivity, toActivity } from "../lib/activity";
import { BADGE_MS, badgeFor } from "../lib/badge";
import { createApiClient } from "../lib/api";
import type { AutosaveDone, ExtMessage } from "../lib/messages";
import { appendMockInbox } from "../lib/mock-inbox";
import { createOutbox } from "../lib/outbox";
import type { SubmitResult } from "../lib/outbox";
import { confirmSessionItem, rememberPrompt, rememberSession } from "../lib/library";
import { buildPrompt } from "../lib/prompts";
import { buildWebClip, defaultClipChoice } from "../lib/requests";
import { saveSession, type SaveSessionResult } from "../lib/sessions";
import { extractTab } from "../lib/tab-extract";
import { rememberPendingClose, tabsStillToClose, takePendingClose } from "../lib/session-close";
import { chromeStore, isMockMode, loadSettings, saveSettings } from "../lib/settings";
import { renderPageToast, toastFor, type PageToastView } from "../lib/page-toast";
import { rememberCapture, updateCaptureFolder } from "../lib/captured";
import { ASK_DRAFT_KEY } from "../lib/messages";
import { openSidePanel } from "../lib/side-panel";

const SAVE_DEDUP_MS = 60_000;
const MENU_ID = "kortex-highlight";
const PROMPT_MENU_ID = "kortex-save-prompt";
const FLUSH_ALARM = "kortex-outbox";
const ACTION_FORM_ID = "kortex-action-form";
const ACTION_PANEL_ID = "kortex-action-panel";
const ACTION_AUTOSAVE_OFF_ID = "kortex-action-autosave-off";
const ACTION_MANAGER_ID = "kortex-action-manager";
/** Back to popup-less Autosave if the form popup from the context menu never opened (openPopup refused). */
const POPUP_RESET_ALARM = "kortex-popup-reset";
/** The popup page WXT builds; `?form=1` opens the form even while Autosave is on. */
const POPUP = "popup.html";
/** Autosave: how long the full page reader may take before the plain metadata is saved instead. */
const AUTOSAVE_READ_BUDGET_MS = 8000;
/** A second click on the same page within this window does not save twice. */
const AUTOSAVE_REPEAT_MS = 5000;
/** The click is answered on the page within this time, whatever the page or Kortex do. */
const AUTOSAVE_CEILING_MS = 28_000;

/** Autosave feedback on the page; pages that refuse scripts (store, PDF viewer) keep the badge only. */
async function pageToast(tabId: number, view: PageToastView) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: renderPageToast, args: [view] });
  } catch {
    /* no access to this page: the badge is the feedback */
  }
}

/** C2 Autosave: the outcome on the toolbar badge of the tab, then the plain icon again. */
async function flashBadge(tabId: number, result: SubmitResult) {
  const view = badgeFor(result);
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: view.color });
    await chrome.action.setBadgeText({ tabId, text: view.text });
    setTimeout(() => void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined), BADGE_MS);
  } catch {
    /* tab closed meanwhile */
  }
}

export default defineBackground(() => {
  // The worker is a context of its own: the stored language is read once per start, every handler
  // that produces text waits for it. Until then the browser language applies.
  const language = initLanguage();

  /** Context menu entries in the current language (rebuilt on install, browser start and a language change). */
  function buildMenus() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: MENU_ID, title: tx("menu", "Save highlight to Kortex"), contexts: ["selection"] });
      chrome.contextMenus.create({ id: PROMPT_MENU_ID, title: t("Save as prompt"), contexts: ["selection"] });
      chrome.contextMenus.create({ id: ACTION_FORM_ID, title: t("Clip with form …"), contexts: ["action"] });
      chrome.contextMenus.create({ id: ACTION_PANEL_ID, title: t("Open sessions & prompts"), contexts: ["action"] });
      chrome.contextMenus.create({ id: ACTION_MANAGER_ID, title: t("Open tab manager (full screen)"), contexts: ["action"] });
      chrome.contextMenus.create({ id: ACTION_AUTOSAVE_OFF_ID, title: t("Turn off Autosave"), contexts: ["action"] });
    });
  }
  watchLanguage(buildMenus);

  const api = createApiClient({
    getSettings: () => loadSettings(chromeStore),
    recordMock: (entry) => appendMockInbox(chromeStore, entry),
  });
  const outbox = createOutbox({
    store: chromeStore,
    api,
    // Live captures leave a trace (folder, status) for the options page; mock ones have their own inbox.
    onDelivered: async (request, response) => {
      // A session that was queued offline gets its item_id now (no twin next to the server entry, no ghost after delete).
      if (request.kind === "note" && request.type_hint === "session" && request.idempotency_key) {
        await confirmSessionItem(chromeStore, request.idempotency_key, response.item_id).catch(() => undefined);
        await closeAfterDelivery(request.idempotency_key).catch(() => undefined);
      }
      // The popup's duplicate banner and the side panel's status line read this local index.
      if (request.kind === "web_clip" || request.kind === "highlight") {
        const local = isMockMode(await loadSettings(chromeStore));
        await rememberCapture(chromeStore, request.url, {
          item_id: response.item_id,
          folder_path: response.folder_path,
          at: new Date().toISOString(),
          title: request.kind === "web_clip" ? request.title : request.page_title,
          ...(local ? { local } : {}),
          ...(response.suggested_tags?.length ? { tags: response.suggested_tags.slice(0, 6) } : {}),
        }).catch(() => undefined);
      }
      const late = request.idempotency_key ? lateToasts.get(request.idempotency_key) : undefined;
      if (late && request.idempotency_key) {
        lateToasts.delete(request.idempotency_key);
        await language;
        void pageToast(late.tabId, { tone: "ok", title: t("Now saved to Kortex"), detail: late.title });
        void flashBadge(late.tabId, { ok: true, delivered: true, response });
      }
      if (isMockMode(await loadSettings(chromeStore))) return;
      await appendActivity(chromeStore, toActivity(request, response, new Date().toISOString()));
    },
  });

  /**
   * Closes the given tabs and returns the ids that are really gone. Robust against what made "Save & close"
   * flaky: ids that vanished meanwhile, Chrome's "Tabs cannot be edited right now" while the user drags a tab
   * (retried), and one bad id failing the whole batch (each tab is closed on its own). Never closes the last tab of a
   * window (the browser could quit): a fresh tab is opened first.
   */
  async function closeTabsSafely(windowId: number, ids: number[]): Promise<number[]> {
    if (!ids.length) return [];
    const all = await chrome.tabs.query({ windowId }).catch(() => [] as chrome.tabs.Tab[]);
    const alive = ids.filter((id) => all.some((t) => t.id === id));
    if (!alive.length) return [];
    if (all.every((t) => t.id !== undefined && alive.includes(t.id))) await chrome.tabs.create({ windowId }).catch(() => undefined);
    const closed: number[] = [];
    let todo = alive;
    for (let attempt = 0; attempt < 4 && todo.length; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      const results = await Promise.allSettled(todo.map((id) => chrome.tabs.remove(id)));
      const failed: number[] = [];
      results.forEach((r, i) => (r.status === "fulfilled" ? closed.push(todo[i]!) : failed.push(todo[i]!)));
      // A tab that is gone by now counts as closed; only the ones still open are retried.
      const still = failed.length ? await chrome.tabs.query({ windowId }).catch(() => [] as chrome.tabs.Tab[]) : [];
      for (const id of failed) if (!still.some((t) => t.id === id)) closed.push(id);
      todo = failed.filter((id) => still.some((t) => t.id === id));
    }
    return closed;
  }
  /** A session that was queued with "close tabs": close its tabs now that Kortex confirmed it. */
  async function closeAfterDelivery(key: string) {
    const pending = await takePendingClose(chromeStore, key);
    if (!pending) return;
    const current = await chrome.tabs.query({ windowId: pending.windowId }).catch(() => []);
    await closeTabsSafely(pending.windowId, tabsStillToClose(pending, current));
  }

  const ensureFlushAlarm = () => void chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });

  /**
   * Autosave is popup-less: with the popup switched off, the toolbar click and Alt+K (`_execute_action`)
   * reach `action.onClicked`, which grants activeTab like the popup did. The save then never depends on a
   * popup staying open, and the page shows a small toast plus the badge.
   */
  async function syncActionMode() {
    const settings = await loadSettings(chromeStore);
    try {
      await chrome.action.setPopup({ popup: settings.autosave ? "" : POPUP });
    } catch {
      /* older browser: the popup's own Autosave view stays the fallback */
    }
  }
  void syncActionMode();

  chrome.runtime.onInstalled.addListener((details) => {
    // First start of a build without a preconfigured Kortex: ask for the server on the options page.
    if (details.reason === "install") {
      void loadSettings(chromeStore).then((s) => {
        if (!s.baseUrl.trim()) void chrome.runtime.openOptionsPage();
      });
    }
    void language.then(buildMenus);
    ensureFlushAlarm();
    void syncActionMode();
  });

  // Queued captures wait for the user to finish setup: deliver right after the settings change
  // and when the browser starts, not only on the next alarm.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      void outbox.flush({ force: true });
      void syncActionMode();
    }
  });
  // The form popup opened from the context menu while Autosave is on: back to popup-less once it closes.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "kortex-popup") port.onDisconnect.addListener(() => void syncActionMode());
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureFlushAlarm(); // alarms do not always survive a browser restart
    void language.then(buildMenus); // the browser language may have changed since the menus were built
    void outbox.flush();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) void outbox.flush();
    if (alarm.name === POPUP_RESET_ALARM) void syncActionMode();
  });

  /** The full-page tab manager (Toby-style board); an open one is focused instead of opening a second. */
  async function openManager() {
    const url = chrome.runtime.getURL("/tabs.html");
    const [open] = await chrome.tabs.query({ url }).catch(() => [] as chrome.tabs.Tab[]);
    if (open?.id !== undefined) {
      await chrome.tabs.update(open.id, { active: true }).catch(() => undefined);
      if (open.windowId !== undefined) await chrome.windows.update(open.windowId, { focused: true }).catch(() => undefined);
      return;
    }
    await chrome.tabs.create({ url }).catch(() => undefined);
  }

  /** Submits a prompt and remembers it for the side panel catalogue (delivered or queued). */
  async function savePrompt(text: string): Promise<SubmitResult> {
    await language;
    const request = buildPrompt(text);
    const res = await outbox.submit(request).catch((e: unknown): SubmitResult => ({ ok: false, error: { code: "server_error", message: e instanceof Error ? e.message : t("Error") } }));
    if (res.ok && request.kind === "note") {
      const itemId = res.delivered ? (res.response as { item_id?: unknown }).item_id : undefined;
      await rememberPrompt(chromeStore, {
        id: request.idempotency_key!,
        title: request.title,
        text: request.content_md,
        saved_at: request.captured_at,
        ...(typeof itemId === "string" && itemId ? { item_id: itemId } : {}),
      });
    }
    return res;
  }

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === ACTION_FORM_ID) {
      void (async () => {
        await chrome.action.setPopup({ popup: `${POPUP}?form=1` });
        // Older Chrome: the next click opens the form; after a minute Autosave is back either way.
        void chrome.alarms.create(POPUP_RESET_ALARM, { delayInMinutes: 1 });
        await chrome.action.openPopup().catch(() => undefined);
      })();
      return;
    }
    if (info.menuItemId === ACTION_PANEL_ID) {
      void openSidePanel(tab?.windowId);
      return;
    }
    if (info.menuItemId === ACTION_MANAGER_ID) {
      void openManager();
      return;
    }
    if (info.menuItemId === ACTION_AUTOSAVE_OFF_ID) {
      void saveSettings(chromeStore, { autosave: false });
      return;
    }
    if (info.menuItemId === PROMPT_MENU_ID && tab?.id !== undefined && info.selectionText?.trim()) {
      const tabId = tab.id;
      void savePrompt(info.selectionText).then((res) => flashBadge(tabId, res));
      return;
    }
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
    const msg: ExtMessage = { type: "kortex/highlight-selection", fallbackText: info.selectionText };
    void chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined);
  });

  /**
   * C2 Autosave: the toolbar click / Alt+K is the order. Extraction and delivery run here, not in the
   * popup, so closing the popup early cannot lose the capture; failures that can be retried land in the
   * outbox, and the badge reports the outcome.
   */
  async function autosaveTab(tabId: number): Promise<AutosaveDone | null> {
    await language;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    const page = tab ? await extractTab(tab, { budgetMs: AUTOSAVE_READ_BUDGET_MS }).catch(() => null) : null;
    if (!page) return null;
    const settings = await loadSettings(chromeStore);
    const request = buildWebClip(page, defaultClipChoice(page, settings));
    const result = await outbox
      .submit(request)
      .catch((e: unknown): SubmitResult => ({ ok: false, error: { code: "server_error", message: e instanceof Error ? e.message : t("Error") } }));
    void flashBadge(tabId, result);
    if (result.ok && !result.delivered) {
      // Kortex was slow or away: tell the page once the retry got through, and retry soon instead of in a minute.
      if (request.idempotency_key) lateToasts.set(request.idempotency_key, { tabId, title: page.title });
      retrySoon();
    }
    return { page, result };
  }

  /** Captures that were queued from an Autosave click: the tab hears about the late delivery. */
  const lateToasts = new Map<string, { tabId: number; title?: string }>();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** One quick extra delivery attempt a few seconds after a queued capture (the alarm stays the safety net). */
  function retrySoon(ms = 8000) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void outbox.flush({ force: true }).catch(() => undefined), ms);
  }

  /** Toolbar click / Alt+K while Autosave is on: toast "saving", save, toast with the outcome. */
  const recentClicks = new Map<string, number>();
  async function clickSave(tab: chrome.tabs.Tab) {
    if (tab.id === undefined) return;
    const tabId = tab.id;
    await language;
    if (!tab.url || !/^https?:/.test(tab.url)) {
      void flashBadge(tabId, { ok: false, error: { code: "invalid_request", message: t("This page cannot be captured.") } });
      return;
    }
    const key = `${tabId}|${tab.url}`;
    const last = recentClicks.get(key);
    if (last && Date.now() - last < AUTOSAVE_REPEAT_MS) {
      void pageToast(tabId, { tone: "ok", title: t("Already saved"), detail: t("Captured just now.") });
      return;
    }
    recentClicks.set(key, Date.now());
    void pageToast(tabId, { tone: "busy", title: t("Saving to Kortex …") });
    // Hard ceiling: reading (8 s) + delivery (15 s) + slack. The toast never hangs on "saving".
    const done = await Promise.race([
      autosaveTab(tabId).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), AUTOSAVE_CEILING_MS)),
    ]);
    if (!done || !done.result.ok) recentClicks.delete(key); // a failed save may be retried right away
    const mock = isMockMode(await loadSettings(chromeStore));
    await pageToast(tabId, toastFor(done?.result ?? null, { mock, pageTitle: done?.page.title }));
  }
  chrome.action.onClicked.addListener((tab) => void clickSave(tab));

  // Alt+S side panel, Alt+T tab manager (Alt+K is _execute_action). The panel must open inside the gesture.
  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === "open-sidepanel") void openSidePanel(tab?.windowId);
    else if (command === "open-manager") void openManager();
  });

  /** Base64 data URL (the popup's screenshot) to a Blob for the multipart upload. */
  function dataUrlToBlob(dataUrl: string): Blob {
    const [head, body = ""] = dataUrl.split(",", 2);
    const type = /^data:([^;,]+)/.exec(head ?? "")?.[1] ?? "image/png";
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  // Same set of tabs, same close choice: one save at a time and the same result shortly after (double click,
  // second listener, repeated message). Otherwise two sessions with identical content would appear.
  const recentSaves = new Map<string, { at: number; done: Promise<SaveSessionResult> }>();
  function handleSaveSession(msg: Extract<ExtMessage, { type: "kortex/save-session" }>) {
    const key = `${msg.windowId}|${msg.close}|${msg.windowName ?? ""}|${msg.tabIds ? [...msg.tabIds].sort((a, b) => a - b).join(",") : "*"}`;
    const hit = recentSaves.get(key);
    if (hit && Date.now() - hit.at < SAVE_DEDUP_MS) return hit.done;
    const done = saveSessionOnce(msg);
    recentSaves.set(key, { at: Date.now(), done });
    void done.then((r) => {
      if (!r.ok && r.reason !== "queued") recentSaves.delete(key); // a failed or empty save may be retried right away
    });
    return done;
  }

  async function saveSessionOnce(msg: Extract<ExtMessage, { type: "kortex/save-session" }>): Promise<SaveSessionResult> {
    await language;
    const all = await chrome.tabs.query({ windowId: msg.windowId });
    const tabs = msg.tabIds ? all.filter((t) => t.id !== undefined && msg.tabIds!.includes(t.id)) : all;
    const result = await saveSession({
      tabs,
      close: msg.close,
      windowName: msg.windowName,
      submit: (req) => outbox.submit(req),
      closeTabs: (ids) => closeTabsSafely(msg.windowId, ids),
    });
    // Kortex answered too late (queued): close the tabs once the outbox delivers the session.
    if (!result.ok && result.reason === "queued" && msg.close && result.request?.idempotency_key) {
      await rememberPendingClose(chromeStore, {
        key: result.request.idempotency_key,
        windowId: msg.windowId,
        tabs: tabs.flatMap((t) => (t.id !== undefined && !t.pinned && /^https?:/i.test(t.url ?? "") ? [{ id: t.id, url: t.url! }] : [])),
        at: Date.now(),
      });
      retrySoon(3000); // try again in a moment instead of waiting for the next alarm
    }
    if (result.ok || result.reason === "queued") {
      const req = result.request!;
      await rememberSession(chromeStore, tabs.filter((t) => /^https?:/i.test(t.url ?? "")), {
        id: req.idempotency_key!,
        title: req.title,
        saved_at: req.captured_at,
        ...(result.ok ? { item_id: result.itemId } : {}),
      });
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, sendResponse) => {
    // Only our own extension contexts (popup, content scripts) may enqueue captures.
    if (sender.id !== chrome.runtime.id) return false;
    switch (msg?.type) {
      case "kortex/ingest":
        language
          .then(() => (msg.request.kind === "note" && msg.request.type_hint === "prompt" ? savePrompt(msg.request.content_md) : outbox.submit(msg.request)))
          .catch((e: unknown): SubmitResult => ({ ok: false, error: { code: "server_error", message: e instanceof Error ? e.message : t("Error") } }))
          .then((res) => {
            sendResponse(res);
            if (msg.badgeTabId !== undefined) void flashBadge(msg.badgeTabId, res);
          });
        return true; // async response
      case "kortex/autosave":
        void autosaveTab(msg.tabId).then(sendResponse, () => sendResponse(null));
        return true;
      case "kortex/save-session":
        void handleSaveSession(msg).then(sendResponse, (e: unknown) =>
          sendResponse({ ok: false, reason: "error", message: e instanceof Error ? e.message : t("Saving failed") } satisfies SaveSessionResult),
        );
        return true;
      case "kortex/open-manager":
        void openManager().then(() => sendResponse(null));
        return true;
      case "kortex/close-tabs":
        void chrome.tabs
          .query({ windowId: msg.windowId })
          .then((all) => closeTabsSafely(msg.windowId, all.filter((tab) => tab.id !== undefined && msg.tabIds.includes(tab.id) && !tab.pinned).map((tab) => tab.id!)))
          .catch(() => [] as number[])
          .then(sendResponse);
        return true;
      case "kortex/reopen-tabs":
        void Promise.allSettled(msg.urls.map((url) => chrome.tabs.create({ windowId: msg.windowId, url, active: false }))).then(() => sendResponse(null));
        return true;
      case "kortex/status":
        void language
          .then(() => api.status(msg.itemId))
          .then((res) => {
            if (res.ok && (res.data.status === "processed" || res.data.status === "archived")) void updateCaptureFolder(chromeStore, msg.itemId, res.data.folder_path).catch(() => undefined);
            sendResponse(res);
          });
        return true;
      case "kortex/upload":
        void language
          .then(() => api.uploadFile(dataUrlToBlob(msg.dataUrl), msg.name, msg.fields))
          .catch((e: unknown) => ({ ok: false as const, error: { code: "server_error" as const, message: e instanceof Error ? e.message : t("Error") } }))
          .then(async (res) => {
            if (res.ok && !isMockMode(await loadSettings(chromeStore))) {
              await appendActivity(chromeStore, {
                at: new Date().toISOString(),
                kind: "file",
                title: msg.fields.title ?? msg.name,
                item_id: res.item_id,
                folder_path: res.folder_path,
                auto_routed: res.auto_routed,
                status: res.status,
                duplicate: res.duplicate,
                replayed: false,
              }).catch(() => undefined);
            }
            sendResponse(res);
          });
        return true;
      case "kortex/open-sidepanel": {
        // A question from the page's selection bar: the panel picks it up when it opens.
        const windowId = sender.tab?.windowId;
        // Open first (as close to the click as possible), the draft follows; the panel also watches storage.
        const opened = openSidePanel(windowId, { fallbackWindow: false });
        void (msg.ask ? chrome.storage.local.set({ [ASK_DRAFT_KEY]: msg.ask }) : Promise.resolve())
          .then(() => opened)
          .then(sendResponse, () => sendResponse("none"));
        return true;
      }
      case "kortex/remind":
        void language.then(() => api.remind(msg.itemId, msg.remindAt)).then(sendResponse);
        return true;
      case "kortex/highlight-delete":
        void language.then(() => api.deleteHighlight(msg.highlightId)).then(sendResponse);
        return true;
      case "kortex/flush":
        language.then(() => outbox.flush({ force: true })).then(sendResponse, () => sendResponse(null));
        return true;
      case "kortex/outbox-remove":
        outbox.remove(msg.id).then(() => sendResponse(null), () => sendResponse(null));
        return true;
      default:
        return false;
    }
  });
});
