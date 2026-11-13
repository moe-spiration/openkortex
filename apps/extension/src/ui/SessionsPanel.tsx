// Side-Panel "Sessions" (Toby-Stil): oben die offenen Tabs des Fensters als Karten (speichern & schließen, auswählen,
// in Sessions ziehen), darunter die gespeicherten Sessions als Sammlungen mit Tab-Karten. Die Bausteine (Drag & Drop,
// Karten, Toasts) teilt sich das Panel mit dem Vollbild-Tab-Manager (ui/TabBoard.tsx, entrypoints/tabs).
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Toaster } from "sonner";
import { Button } from "@kortex/ui";
import { t } from "../i18n";
import { ArchiveRestore, RotateCw, Search, X } from "lucide-react";
import { loadSessionLibrary, type SavedSession } from "../lib/library";
import { displayTitle } from "../lib/session-view";
import { chromeStore } from "../lib/settings";
import { SyncLine, useLibrarySync } from "./LibrarySync";
import { StatusChip } from "./StatusChip";
import { NewSessionDrop, OpenTabsSection, SessionList, TabBoard, useBoardSessions } from "./TabBoard";
import { useLive, type LiveStatus } from "./useLive";

export { Favicon } from "./TabBoard";

/* Loader live at module level: a new function per render would re-run the effect in useLive on every render. */
const currentTabs = async () => {
  const win = await chrome.windows.getCurrent();
  return { windowId: win.id!, tabs: await chrome.tabs.query({ windowId: win.id! }) };
};
const NO_TABS = { windowId: -1, tabs: [] as chrome.tabs.Tab[] };
export const loadSessions = () => loadSessionLibrary(chromeStore);
export const NO_SESSIONS: SavedSession[] = [];

/** Title, domains and tab titles; every word has to match. */
export function searchSessions(list: readonly SavedSession[], query: string): SavedSession[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...list];
  return list.filter((s) => {
    const tabs = s.tabs.map((tab) => `${tab.title ?? ""} ${tab.url}`).join(" ");
    const hay = `${displayTitle(s.title)} ${tabs}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

/** Header, sync line, empty and error states, then the sorted collections (filtered by the search). */
export function SavedSessions({
  library,
  query,
  status,
  retry,
  heading = "Sessions",
}: {
  library: ReturnType<typeof useLibrarySync>;
  query: string;
  status: LiveStatus;
  retry: () => void;
  heading?: string;
}) {
  const all = useBoardSessions();
  const sessions = useMemo(() => searchSessions(all, query), [all, query]);
  return (
    <section className="kx-tm-saved" aria-labelledby="kx-tm-saved">
      <header className="kx-tm-sechead">
        <h2 id="kx-tm-saved" className="kx-tm-h">
          {heading}
          {status === "ready" && all.length > 0 && (
            <span className="kx-tm-count">{sessions.length === all.length ? all.length : `${sessions.length}/${all.length}`}</span>
          )}
        </h2>
        <SyncLine sync={library.sync} busy={library.busy} onRefresh={library.refresh} />
        <NewSessionDrop />
      </header>
      {status === "loading" && (
        <div className="kx-tm-state" role="status">
          <span className="kx-spinner" aria-hidden /> {t("Loading sessions …")}
        </div>
      )}
      {status === "error" && (
        <div className="kx-tm-state" role="alert">
          <StatusChip tone="error">{t("Sessions could not be loaded")}</StatusChip>
          <Button size="sm" variant="ghost" onClick={retry}>
            <RotateCw /> {t("Try again")}
          </Button>
        </div>
      )}
      {status === "ready" && sessions.length === 0 && all.length > 0 && <p className="kx-tm-state">{t("No matches for “{query}”.", { query: query.trim() })}</p>}
      {status === "ready" && all.length === 0 && (
        <div className="kx-tm-emptystate">
          <span className="kx-tm-badge" aria-hidden>
            <ArchiveRestore />
          </span>
          <strong>{t("No sessions yet")}</strong>
          <p>{t("Save your open tabs as a session or drag a tab here. You find them here again, together with sessions from Kortex.")}</p>
        </div>
      )}
      {status === "ready" && sessions.length > 0 && <SessionList sessions={sessions} />}
    </section>
  );
}

/** `/` focuses the search unless the user is typing somewhere else. */
function useSlashFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || target?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [ref]);
}

export function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useSlashFocus(ref);
  return (
    <div className="kx-sp-search">
      <label className="kx-control">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && value && (e.preventDefault(), onChange(""))}
          placeholder={label}
          aria-label={label}
          aria-keyshortcuts="/"
        />
        {value ? (
          <button type="button" className="kx-sp-clear" aria-label={t("Clear search")} onClick={() => (onChange(""), ref.current?.focus())}>
            <X aria-hidden />
          </button>
        ) : (
          <kbd className="kx-sp-kbd" aria-hidden>/</kbd>
        )}
      </label>
    </div>
  );
}

/** Toasts in the Kortex look (flat, token colours); one per page. */
export function KortexToaster({ theme }: { theme: "light" | "dark" }) {
  return (
    <Toaster
      theme={theme}
      position="bottom-center"
      gap={8}
      offset={12}
      visibleToasts={3}
      toastOptions={{ className: "kx-toast2", duration: 4000 }}
    />
  );
}

export function SessionsPanel({ baseUrl, theme = "dark" }: { baseUrl: string; theme?: "light" | "dark" }) {
  const library = useLibrarySync("session");
  const { value: all, status, retry } = useLive(loadSessions, NO_SESSIONS);
  const { value: win, status: tabsStatus } = useLive(currentTabs, NO_TABS, true);
  const [q, setQ] = useState("");
  return (
    <div className="kx-sp grid gap-4">
      <SearchField value={q} onChange={setQ} label={t("Search sessions")} />
      <TabBoard layout="panel" baseUrl={baseUrl} sessions={all}>
        <OpenTabsSection windowId={win.windowId} tabs={win.tabs} loading={tabsStatus === "loading"} />
        <SavedSessions library={library} query={q} status={status} retry={retry} />
      </TabBoard>
      <KortexToaster theme={theme} />
    </div>
  );
}
