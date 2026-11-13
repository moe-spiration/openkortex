import { StrictMode, useEffect, useState } from "react";
import { Button } from "@kortex/ui";
import { Maximize2, PanelRight, Settings2 } from "lucide-react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "../../styles/ext.css";
import { startPage, t } from "../../i18n";
import { autosaveViaBackground, fetchStatusViaBackground, openManagerViaBackground, remindViaBackground, sendViaBackground } from "../../lib/messages";
import type { SubmitResult } from "../../lib/outbox";
import type { PageMeta } from "../../lib/page-meta";
import { extractTab } from "../../lib/tab-extract";
import { DEFAULT_SETTINGS, chromeStore, isMockMode, loadSettings, saveSettings, type ExtensionSettings } from "../../lib/settings";
import type { ClipSettingsPatch } from "../../ui/ClipSettings";
import { ClipperPanel } from "../../ui/ClipperPanel";
import { QuickSave } from "../../ui/QuickSave";
import { ThemeRoot, useDocumentTheme } from "../../ui/ThemeRoot";

type Loaded = { settings: ExtensionSettings; page: PageMeta | null; reason?: string; tabId?: number; /** Autosave already ran in the background worker. */ saved?: SubmitResult };

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
  const page = await extractTab(tab);
  return { settings, tabId: tab.id, page };
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

function App() {
  const [data, setData] = useState<Loaded | null>(null);
  useEffect(() => void load().then(setData), []);
  const settings = data?.settings ?? DEFAULT_SETTINGS;
  useDocumentTheme(settings.theme);
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
