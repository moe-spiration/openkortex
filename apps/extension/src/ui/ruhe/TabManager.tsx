// Tab manager in the Ruhe look (2026-11-27): location bar with search, the session index left (with the sync state
// at the bottom), sessions as flat cards or a list in the middle with the agent's suggestion on top, open tabs of
// all windows on the right. Drag and drop, save & close and undo are TabBoard's (unchanged engine).
import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Layers, PanelRight, Rows3, Settings2, Sparkles, X } from "lucide-react";
import { t, tn } from "../../i18n";
import { sessionKey } from "../../lib/library";
import { cardTitle } from "../../lib/session-view";
import { suggestSessionFit } from "../../lib/session-suggest";
import { hasSidePanel, openSidePanel } from "../../lib/side-panel";
import { useLibrarySync } from "../LibrarySync";
import { KortexToaster, NO_SESSIONS, SavedSessions, loadSessions, searchSessions } from "../SessionsPanel";
import { OpenTabsSection, TabBoard, useBoardActions, useBoardSessions } from "../TabBoard";
import { ThemeRoot } from "../ThemeRoot";
import { useLive } from "../useLive";
import { Btn, IconBtn, LocBar } from "./kit";
import { RxSearch } from "./SidePanel";

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
const VIEW_KEY = "kortex.tm.view";

function Index({ query, active, onJump, sync }: { query: string; active: string | null; onJump: (key: string) => void; sync: ReturnType<typeof useLibrarySync> }) {
  const all = useBoardSessions();
  const sessions = searchSessions(all, query);
  const ok = sync.sync?.state === "synced";
  return (
    <nav className="rx-tm-idx" aria-label="Sessions">
      <button type="button" className="rx-row" data-active={active === null ? "" : undefined} onClick={() => onJump("")}>
        <Layers aria-hidden />
        <span className="rx-row-t">{t("All sessions")}</span>
        <span className="rx-row-r rx-num">{all.length}</span>
      </button>
      {sessions.length > 0 && <div className="rx-tm-grp">Sessions</div>}
      {sessions.map((s) => (
        <button key={s.id} type="button" className="rx-row" data-active={active === sessionKey(s) ? "" : undefined} onClick={() => onJump(sessionKey(s))}>
          <Layers aria-hidden />
          <span className="rx-row-t">{cardTitle(s)}</span>
          <span className="rx-row-r rx-num">{s.tabs.length}</span>
        </button>
      ))}
      {all.length > 0 && sessions.length === 0 && <div className="rx-faint" style={{ padding: "6px 8px", fontSize: 12 }}>{t("No sessions.")}</div>}
      <div className="rx-tm-foot" title={sync.sync?.state === "error" ? sync.sync.message : undefined}>
        <span className={`rx-dot ${ok ? "rx-dot--ok" : "rx-dot--off"}`} aria-hidden />
        <span className="rx-trunc">{sync.busy || !sync.sync ? t("Syncing …") : ok ? t("Synced with Kortex") : sync.sync.state === "offline" ? t("Offline, last state") : t("Local only")}</span>
        <span className="rx-grow" />
        <Btn style={{ height: 22, padding: "0 6px", fontSize: 11.5 }} disabled={sync.busy} onClick={sync.refresh}>
          {t("Sync")}
        </Btn>
      </div>
    </nav>
  );
}

/** "Kortex suggests: 3 open tabs fit “Research RAG”." with Add / dismiss. */
function Suggestion({ open }: { open: chrome.tabs.Tab[] }) {
  const { apply, sessions } = useBoardActions();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const fit = useMemo(() => suggestSessionFit(sessions, open, { dismissed }), [sessions, open, dismissed]);
  if (!fit) return null;
  const s = sessions.find((x) => sessionKey(x) === fit.sessionKey);
  return (
    <div className="rx-suggest" role="note">
      <Sparkles aria-hidden />
      <span className="rx-grow">
        {t("Kortex suggests:")} <b>{tn(fit.tabs.length, "{n} open tab", "{n} open tabs")}</b> {t("fit “{name}”.", { name: s ? cardTitle(s) : fit.title })}
      </span>
      <Btn variant="soft" style={{ height: 26 }} onClick={() => void apply({ type: "add-open", sessionKey: fit.sessionKey, tabs: fit.tabs as never, index: s?.tabs.length })}>
        {t("Add")}
      </Btn>
      <IconBtn small label={t("Dismiss")} onClick={() => setDismissed((d) => [...d, fit.sessionKey])}>
        <X />
      </IconBtn>
    </div>
  );
}

export function RuheTabManager({ baseUrl, theme }: { baseUrl: string; theme: "light" | "dark" }) {
  const library = useLibrarySync("session");
  const { value: all, status, retry } = useLive(loadSessions, NO_SESSIONS);
  const { value: win, status: winStatus } = useLive(allWindows, NO_WINDOWS, true);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "list">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* fine */
    }
  }, [view]);
  const openTabs = useMemo(() => win.windows.flatMap((w) => w.tabs), [win]);
  const savable = openTabs.filter((x) => /^https?:/i.test(x.url ?? "")).length;
  const jump = (key: string) => {
    setActive(key || null);
    if (!key) return document.querySelector(".rx-tm-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
    const el = document.querySelector<HTMLElement>(`.kx-tm-session[data-key="${CSS.escape(key)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.querySelector<HTMLElement>(".kx-tm-stitle")?.focus({ preventScroll: true });
  };
  return (
    <ThemeRoot theme={theme} look="ruhe" className="rx rx-tm">
      <TabBoard layout="page" baseUrl={baseUrl} sessions={all}>
        <LocBar title={t("Tabs")} place={active ? cardTitle(all.find((s) => sessionKey(s) === active) ?? { title: "", tabs: [] }) : t("All sessions")} className="rx-tm-loc">
          <div style={{ width: 280 }}>
            <RxSearch value={q} onChange={setQ} label={t("Search sessions and tabs")} />
          </div>
          {hasSidePanel() && (
            <IconBtn label={t("Side panel")} onClick={() => void openSidePanel(win.current)}>
              <PanelRight />
            </IconBtn>
          )}
          <IconBtn label={t("Open options")} onClick={() => void chrome.runtime.openOptionsPage()}>
            <Settings2 />
          </IconBtn>
        </LocBar>
        <div className="rx-tm-grid">
          <Index query={q} active={active} onJump={jump} sync={library} />
          <main className="rx-tm-main" data-view={view}>
            <div className="rx-vbar">
              <div className="rx-views" role="radiogroup" aria-label={t("View")}>
                <button type="button" role="radio" className="rx-view" aria-selected={view === "cards"} aria-checked={view === "cards"} onClick={() => setView("cards")}>
                  <LayoutGrid size={13} aria-hidden /> {t("Cards")}
                </button>
                <button type="button" role="radio" className="rx-view" aria-selected={view === "list"} aria-checked={view === "list"} onClick={() => setView("list")}>
                  <Rows3 size={13} aria-hidden /> {t("List")}
                </button>
              </div>
              <span className="rx-grow" />
              <span className="rx-faint rx-num" style={{ fontSize: 12 }}>
                {tn(savable, "{n} open tab", "{n} open tabs")}
              </span>
            </div>
            <Suggestion open={openTabs} />
            <div className="rx-tm-scroll kx-tmp-main">
              <SavedSessions library={library} query={q} status={status} retry={retry} />
            </div>
          </main>
          <aside className="rx-tm-rail kx-tmp-rail" aria-label={t("Open tabs")}>
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
            {winStatus === "ready" && win.windows.length === 0 && <p className="rx-faint">{t("No browser windows found.")}</p>}
          </aside>
        </div>
      </TabBoard>
      <KortexToaster theme={theme} />
    </ThemeRoot>
  );
}
