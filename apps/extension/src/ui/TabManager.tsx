// Vollbild-Tab-Manager (tabs.html), Toby als Vorbild: Index der Sessions links, Sammlungen mit Tab-Karten in der
// Mitte, offene Tabs aller Fenster rechts. Alles Ziehen und Speichern läuft über dieselben Bausteine wie im Side-Panel.
import { useState } from "react";
import { AppMark, Button } from "@kortex/ui";
import { PRODUCT_NAME, t } from "../i18n";
import { PanelRight, Settings2 } from "lucide-react";
import { sessionKey } from "../lib/library";
import { cardTitle } from "../lib/session-view";
import { useLibrarySync } from "./LibrarySync";
import { KortexToaster, NO_SESSIONS, SavedSessions, SearchField, loadSessions, searchSessions } from "./SessionsPanel";
import { OpenTabsSection, TabBoard, useBoardSessions } from "./TabBoard";
import { ThemeRoot } from "./ThemeRoot";
import { useLive } from "./useLive";

type WindowTabs = { id: number; focused: boolean; tabs: chrome.tabs.Tab[] };
const allWindows = async (): Promise<{ current: number; windows: WindowTabs[] }> => {
  const [current, wins] = await Promise.all([chrome.windows.getCurrent(), chrome.windows.getAll({ populate: true, windowTypes: ["normal"] })]);
  const windows = wins
    .filter((w) => w.id !== undefined)
    .map((w) => ({ id: w.id!, focused: w.id === current.id, tabs: w.tabs ?? [] }))
    .sort((a, b) => Number(b.focused) - Number(a.focused));
  return { current: current.id ?? -1, windows };
};
const NO_WINDOWS = { current: -1, windows: [] as WindowTabs[] };

/** Left column: jump to a session (and the count), like Toby's collection index. */
function SessionIndex({ query }: { query: string }) {
  const sessions = searchSessions(useBoardSessions(), query);
  const jump = (key: string) => {
    const el = document.querySelector<HTMLElement>(`.kx-tm-session[data-key="${CSS.escape(key)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.querySelector<HTMLElement>(".kx-tm-stitle")?.focus({ preventScroll: true });
  };
  return (
    <nav className="kx-tmp-index" aria-label="Sessions">
      <ul>
        {sessions.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => jump(sessionKey(s))}>
              <span className="kx-truncate kxh-grow">{cardTitle(s)}</span>
              <span className="kx-tm-count">{s.tabs.length}</span>
            </button>
          </li>
        ))}
        {sessions.length === 0 && <li className="kx-tm-meta">{t("No sessions.")}</li>}
      </ul>
    </nav>
  );
}

export function TabManager({ baseUrl, theme }: { baseUrl: string; theme: "light" | "dark" }) {
  const library = useLibrarySync("session");
  const { value: all, status, retry } = useLive(loadSessions, NO_SESSIONS);
  const { value: win, status: winStatus } = useLive(allWindows, NO_WINDOWS, true);
  const [q, setQ] = useState("");
  const openPanel = async () => {
    try {
      await chrome.sidePanel.open({ windowId: win.current });
    } catch {
      /* no side panel (Firefox) */
    }
  };
  return (
    <ThemeRoot theme={theme} className="kx-tmp">
      <TabBoard layout="page" baseUrl={baseUrl} sessions={all}>
        <div className="kx-tmp-grid">
          <aside className="kx-tmp-side">
            <div className="kx-tmp-brand">
              <AppMark size={22} />
              <span>{PRODUCT_NAME} Tabs</span>
            </div>
            <SearchField value={q} onChange={setQ} label={t("Search sessions and tabs")} />
            <SessionIndex query={q} />
            <div className="kx-tmp-sidefoot">
              {typeof chrome.sidePanel?.open === "function" && (
                <Button size="sm" variant="ghost" onClick={() => void openPanel()}>
                  <PanelRight /> {t("Side panel")}
                </Button>
              )}
              <span className="kxh-grow" />
              <Button size="icon-sm" variant="ghost" aria-label={t("Open options")} title={t("Open options")} onClick={() => void chrome.runtime.openOptionsPage()}>
                <Settings2 />
              </Button>
            </div>
          </aside>
          <main className="kx-tmp-main">
            <SavedSessions library={library} query={q} status={status} retry={retry} />
          </main>
          <aside className="kx-tmp-rail" aria-label={t("Open tabs")}>
            {win.windows.map((w, i) => (
              <OpenTabsSection
                key={w.id}
                windowId={w.id}
                tabs={w.tabs}
                current={w.focused}
                loading={winStatus === "loading"}
                title={w.focused ? t("This window") : t("Window {n}", { n: i + 1 })}
              />
            ))}
            {winStatus === "ready" && win.windows.length === 0 && <p className="kx-tm-meta">{t("No browser windows found.")}</p>}
          </aside>
        </div>
      </TabBoard>
      <KortexToaster theme={theme} />
    </ThemeRoot>
  );
}
