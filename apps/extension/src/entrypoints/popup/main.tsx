import { StrictMode, useEffect, useState } from "react";
import { Button } from "@kortex/ui";
import { Maximize2, PanelRight, Settings2 } from "lucide-react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "../../styles/ext.css";
import { startPage, t } from "../../i18n";
import {
  autosaveViaBackground,
  fetchStatusViaBackground,
  highlightSelectionInTab,
  openManagerViaBackground,
  pageInfo,
  queueCommand,
  remindViaBackground,
  sendViaBackground,
  uploadViaBackground,
} from "../../lib/messages";
import { readActivity } from "../../lib/activity";
import { findCapture, type CapturedPage } from "../../lib/captured";
import { readOutbox } from "../../lib/outbox";
import { openSidePanel as openPanel } from "../../lib/side-panel";
import { BlockedPanel, CapturePanel, QuickSaved, type PopupActions } from "../../ui/ruhe/CapturePanel";
import type { SubmitResult } from "../../lib/outbox";
import type { PageMeta } from "../../lib/page-meta";
import { extractTab } from "../../lib/tab-extract";
import { DEFAULT_SETTINGS, chromeStore, isMockMode, loadSettings, saveSettings, type ExtensionSettings } from "../../lib/settings";
import type { ClipSettingsPatch } from "../../ui/ClipSettings";
import { ClipperPanel } from "../../ui/ClipperPanel";
import { QuickSave } from "../../ui/QuickSave";
import { ThemeRoot, useDocumentTheme } from "../../ui/ThemeRoot";

type Loaded = {
  settings: ExtensionSettings;
  page: PageMeta | null;
  reason?: string;
  tabId?: number;
  windowId?: number;
  /** Autosave already ran in the background worker. */
  saved?: SubmitResult;
  /** Ruhe: what this browser already captured of the page, the page's selection, recent folders, queue size. */
  captured?: CapturedPage | null;
  selection?: string;
  contentScript?: boolean;
  recentFolders?: string[];
  queueSize?: number;
};

/** Opened from the toolbar context menu ("Clip with form"): the form, even while Autosave is on. */
const FORCE_FORM = new URLSearchParams(location.search).has("form");

async function load(): Promise<Loaded> {
  // Lets the background worker switch back to popup-less Autosave once this popup closes.
  try {
    chrome.runtime.connect({ name: "kortex-popup" });
  } catch {
    /* preview without a worker */
  }
  const settings = await loadSettings(chromeStore);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    return { settings, page: null, reason: t("This page cannot be captured.") };
  }
  if (settings.autosave && !FORCE_FORM) {
    // The click is the order: the worker extracts, stores (or queues) and flashes the badge, even if this popup closes first.
    const done = await autosaveViaBackground(tab.id);
    if (done) return { settings, tabId: tab.id, page: done.page, saved: done.result };
    return { settings, tabId: tab.id, page: null, reason: t("Kortex did not answer.") };
  }
  const [page, info, captured, activity, queue] = await Promise.all([
    extractTab(tab),
    settings.look === "ruhe" ? pageInfo(tab.id) : Promise.resolve(null),
    findCapture(chromeStore, tab.url).catch(() => null),
    readActivity(chromeStore).catch(() => []),
    readOutbox(chromeStore).catch(() => []),
  ]);
  const recentFolders = [...new Set(activity.map((a) => a.folder_path).filter((f): f is string => !!f && f !== "00_Inbox"))].slice(0, 6);
  return {
    settings,
    tabId: tab.id,
    windowId: tab.windowId,
    page,
    captured,
    selection: info?.selection ?? "",
    contentScript: !!info,
    recentFolders,
    queueSize: queue.length,
  };
}

/** C1/C2 changed in the popup: stored right away, like a change on the options page. */
const saveClipSettings = (patch: ClipSettingsPatch) => void saveSettings(chromeStore, patch);
const close = () => window.close();
const openSidePanel = async () => {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id! });
    window.close();
  } catch {
    /* Firefox / older Chrome: no side panel */
  }
};
const openOptions = () => void chrome.runtime.openOptionsPage();

/** Ruhe look: the popup's actions, wired to the browser and the background worker. */
function ruheActions(data: Loaded, setAutosave: (on: boolean) => void): PopupActions {
  const { tabId, windowId, settings } = data;
  return {
    send: sendViaBackground,
    fetchStatus: fetchStatusViaBackground,
    remind: remindViaBackground,
    uploadScreenshot:
      typeof chrome.tabs.captureVisibleTab === "function" && windowId !== undefined
        ? async (fields) => {
            let dataUrl: string;
            try {
              dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
            } catch (e) {
              return { ok: false, error: { code: "invalid_request", message: e instanceof Error ? e.message : t("The page could not be captured.") } };
            }
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
            return uploadViaBackground({ dataUrl, name: `screenshot-${stamp}.png`, fields, pageUrl: data.page?.url });
          }
        : undefined,
    highlightSelection: data.contentScript && tabId !== undefined ? (opts) => highlightSelectionInTab(tabId, opts) : undefined,
    openSidePanel: () => void openPanel(windowId).then(close),
    openManager: () => void openManagerViaBackground().then(close),
    openOptions: (section) => {
      if (section) void chrome.tabs.create({ url: chrome.runtime.getURL(`/options.html#${section}`) }).then(close);
      else void chrome.runtime.openOptionsPage().then(close);
    },
    openItem: (id) => void chrome.tabs.create({ url: `${settings.baseUrl.replace(/\/+$/, "")}/notes/${encodeURIComponent(id)}` }).then(close),
    openForm: () => {
      location.search = "?form=1";
    },
    setAutosave,
    flush: () => void queueCommand({ type: "kortex/flush" }),
    close,
  };
}

function RuhePopup({ data, setData }: { data: Loaded; setData: (d: Loaded) => void }) {
  const setAutosave = (on: boolean) => {
    void saveSettings(chromeStore, { autosave: on });
    setData({ ...data, settings: { ...data.settings, autosave: on } });
  };
  const actions = ruheActions(data, setAutosave);
  const mock = isMockMode(data.settings);
  if (!data.page) return <BlockedPanel actions={actions} settings={data.settings} reason={data.reason} />;
  if (data.saved && !FORCE_FORM) return <QuickSaved page={data.page} result={data.saved} mock={mock} actions={actions} />;
  return (
    <CapturePanel
      page={data.page}
      settings={data.settings}
      mock={mock}
      actions={actions}
      captured={data.captured}
      selection={data.selection}
      recentFolders={data.recentFolders}
      suggestions={data.captured?.tags?.length ? data.captured.tags : undefined}
      queueSize={data.queueSize}
    />
  );
}

function App() {
  const [data, setData] = useState<Loaded | null>(null);
  useEffect(() => void load().then(setData), []);
  const settings = data?.settings ?? DEFAULT_SETTINGS;
  useDocumentTheme(settings.theme, settings.look);
  if (data && settings.look === "ruhe") {
    return (
      <ThemeRoot theme={settings.theme} look="ruhe">
        <RuhePopup data={data} setData={setData} />
      </ThemeRoot>
    );
  }
  return (
    <ThemeRoot theme={settings.theme}>
      {!data ? (
        <div className="grid h-40 w-[360px] place-items-center bg-main-window">
          <span className="kx-spinner" role="status" aria-label={t("Loading")} />
        </div>
      ) : !data.page ? (
        <div className="kx-clip kx-clip--popup grid gap-2">
          <strong className="text-sm">{t("Clip to Kortex")}</strong>
          <span className="text-[13px] text-secondary">{data.reason}</span>
        </div>
      ) : data.settings.autosave && !FORCE_FORM ? (
        // C2 Autosave: the click already saved; this is only the confirmation (badge + short popup).
        <QuickSave
          page={data.page}
          settings={data.settings}
          mock={isMockMode(data.settings)}
          send={() => Promise.resolve(data.saved!)}
          fetchStatus={fetchStatusViaBackground}
          onClose={close}
          onOpenOptions={openOptions}
          onSettingsChange={saveClipSettings}
        />
      ) : (
        <ClipperPanel
          variant="popup"
          page={data.page}
          settings={data.settings}
          mock={isMockMode(data.settings)}
          send={sendViaBackground}
          fetchStatus={fetchStatusViaBackground}
          remind={remindViaBackground}
          onClose={close}
          onOpenOptions={openOptions}
          onSettingsChange={saveClipSettings}
        />
      )}
      {data && (
        <nav className="kx-pop-foot" aria-label={t("More areas")}>
          {typeof chrome.sidePanel?.open === "function" && (
            <Button size="sm" variant="ghost" onClick={() => void openSidePanel()}>
              <PanelRight /> Sessions & Prompts
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void openManagerViaBackground().then(close)}>
            <Maximize2 /> {t("Tab manager")}
          </Button>
          <span className="kxh-grow" />
          <Button size="icon-sm" variant="ghost" aria-label={t("Open options")} title={t("Open options")} onClick={openOptions}>
            <Settings2 />
          </Button>
        </nav>
      )}
    </ThemeRoot>
  );
}

const root = createRoot(document.getElementById("root")!);
void startPage(() =>
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
