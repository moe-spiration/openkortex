// Side panel view "Tabs" in the Ruhe look: search, this window's open tabs and the sessions. The engine (drag and
// drop, save & close, undo) is TabBoard; its blocks are styled for Ruhe in ruhe-ext.css / ruhe-ui.css.
import { useState } from "react";
import { t } from "../../i18n";
import { useLibrarySync } from "../LibrarySync";
import { KortexToaster, NO_SESSIONS, SavedSessions, loadSessions } from "../SessionsPanel";
import { OpenTabsSection, TabBoard } from "../TabBoard";
import { useLive } from "../useLive";
import { RxSearch } from "./SidePanel";

const currentTabs = async () => {
  const win = await chrome.windows.getCurrent();
  return { windowId: win.id!, tabs: await chrome.tabs.query({ windowId: win.id! }) };
};
const NO_TABS = { windowId: -1, tabs: [] as chrome.tabs.Tab[] };

export function RuheTabsPanel({ baseUrl, theme }: { baseUrl: string; theme: "light" | "dark" }) {
  const library = useLibrarySync("session");
  const { value: all, status, retry } = useLive(loadSessions, NO_SESSIONS);
  const { value: win, status: tabsStatus } = useLive(currentTabs, NO_TABS, true);
  const [q, setQ] = useState("");
  return (
    <>
      <div style={{ padding: "10px 12px 4px" }}>
        <RxSearch value={q} onChange={setQ} label={t("Search tabs and sessions")} />
      </div>
      <div className="rx-sp-scroll rx-sp-tabs kx-sp" style={{ overflow: "auto" }}>
        <TabBoard layout="panel" baseUrl={baseUrl} sessions={all}>
          <OpenTabsSection windowId={win.windowId} tabs={win.tabs} loading={tabsStatus === "loading"} />
          <SavedSessions library={library} query={q} status={status} retry={retry} />
        </TabBoard>
      </div>
      <KortexToaster theme={theme} />
    </>
  );
}
