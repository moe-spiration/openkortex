import { StrictMode, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "../../styles/ext.css";
import { startPage, t, tn } from "../../i18n";
import { AppMark, Button } from "@kortex/ui";
import { Check, Copy, LayoutList, Maximize2, MessageSquareCode, Settings2, Trash2, Undo2 } from "lucide-react";
import { deletePromptEntry, loadPromptLibrary, searchPrompts, undoPromptDelete, type DeleteUndo, type SavedPrompt } from "../../lib/library";
import { SyncLine, useLibrarySync } from "../../ui/LibrarySync";
import { openManagerViaBackground } from "../../lib/messages";
import { fillVariables } from "../../lib/prompts";
import { DEFAULT_SETTINGS, chromeStore, loadSettings, type ExtensionSettings } from "../../lib/settings";
import { SearchField, SessionsPanel } from "../../ui/SessionsPanel";
import { ThemeRoot, useDocumentTheme, useResolvedTheme } from "../../ui/ThemeRoot";
import { useLive } from "../../ui/useLive";
import { createApiClient } from "../../lib/api";
import { askKortex } from "../../lib/ask";
import { findCapture, type CapturedPage } from "../../lib/captured";
import { ASK_DRAFT_KEY, focusHighlightInTab, pageInfo, sendViaBackground, type AskDraft, type PageInfo } from "../../lib/messages";
import { loadPageHighlights, type StoredHighlight } from "../../lib/mock-inbox";
import { isMockMode } from "../../lib/settings";
import { RuheSidePanel, type ActivePage, type SidePanelDeps } from "../../ui/ruhe/SidePanel";
import { RuheTabsPanel } from "../../ui/ruhe/TabsPanel";

type View = "sessions" | "prompts";

const loadPrompts = () => loadPromptLibrary(chromeStore);
const NO_PROMPTS: SavedPrompt[] = [];

function PromptCard({ p, onDelete }: { p: SavedPrompt; onDelete: (p: SavedPrompt) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied: nothing to do */
    }
  };
  const removeLabel = p.item_id ? t("Remove from the list (stays in Kortex)") : t("Remove from list");
  return (
    <li className="kx-sp-prompt">
      <div className="kxh-row">
        <div className="kx-truncate kx-t-body-strong kxh-grow" title={p.title}>{p.title}</div>
        <div className="kx-sp-actions" role="toolbar" aria-label={t("Prompt actions")}>
          <Button size="icon-sm" variant="ghost" aria-label={removeLabel} title={removeLabel} onClick={() => onDelete(p)}>
            <Trash2 />
          </Button>
        </div>
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={copied ? t("Copied") : t("Copy prompt")}
          title={copied ? t("Copied") : t("Copy prompt")}
          onClick={() => void copy(p.variables.length ? fillVariables(p.text, values) : p.text)}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <div className="kx-clamp1 kx-t-meta text-muted">{p.text}</div>
      {p.variables.length > 0 && (
        <>
          <Button size="sm" variant="ghost" className="justify-self-start" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t("Hide variables") : tn(p.variables.length, "Fill in {n} variable", "Fill in {n} variables")}
          </Button>
          {open &&
            p.variables.map((v) => (
              <label key={v} className="kx-control">
                <input
                  value={values[v] ?? ""}
                  placeholder={v}
                  aria-label={v}
                  onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))}
                />
              </label>
            ))}
        </>
      )}
    </li>
  );
}

function Prompts() {
  const { value: prompts } = useLive(loadPrompts, NO_PROMPTS);
  const library = useLibrarySync("prompt");
  const [q, setQ] = useState("");
  const [undo, setUndo] = useState<{ title: string; token: DeleteUndo<SavedPrompt> } | null>(null);
  const shown = searchPrompts(prompts, q);
  const remove = async (p: SavedPrompt) => {
    const token = await deletePromptEntry(chromeStore, p);
    setUndo({ title: p.title, token });
  };
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);
  return (
    <div className="kx-sp grid gap-3">
      <SearchField value={q} onChange={setQ} label={t("Search prompts")} />
      <SyncLine sync={library.sync} busy={library.busy} onRefresh={library.refresh} />
      <ul className="kx-sp-prompts">
        {shown.map((p) => <PromptCard key={p.id} p={p} onDelete={(x) => void remove(x)} />)}
        {shown.length === 0 && (
          <li className="kx-sp-state">
            {prompts.length ? t("No matches.") : t("No prompts yet. Save one below a user message in ChatGPT/Claude or by right-clicking selected text.")}
          </li>
        )}
      </ul>
      {undo && (
        <div className="kx-sp-undo" role="status">
          <Trash2 className="size-4 shrink-0" aria-hidden />
          <span className="kx-truncate kxh-grow">{t("“{title}” removed", { title: undo.title })}</span>
          <Button size="sm" onClick={() => void undoPromptDelete(chromeStore, undo.token).then(() => setUndo(null))} autoFocus>
            <Undo2 /> {t("Undo")}
          </Button>
        </div>
      )}
    </div>
  );
}

const VIEWS: { value: View; label: string; icon: ReactNode }[] = [
  { value: "sessions", label: "Sessions", icon: <LayoutList aria-hidden /> },
  { value: "prompts", label: "Prompts", icon: <MessageSquareCode aria-hidden /> },
];

const api = createApiClient({ getSettings: () => loadSettings(chromeStore) });
const DRAFT_MAX_AGE_MS = 5 * 60_000;

async function activePage(): Promise<ActivePage | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return null;
  return { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title ?? "", favIconUrl: tab.favIconUrl };
}

async function takeDraft(): Promise<AskDraft | null> {
  try {
    const d = (await chrome.storage.local.get(ASK_DRAFT_KEY))[ASK_DRAFT_KEY] as AskDraft | undefined;
    if (!d) return null;
    await chrome.storage.local.remove(ASK_DRAFT_KEY);
    return Date.now() - d.at < DRAFT_MAX_AGE_MS ? d : null;
  } catch {
    return null;
  }
}

/** The active tab of this window and what Kortex knows about it, kept current while the user browses. */
function usePageState() {
  const [page, setPage] = useState<ActivePage | null>(null);
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [captured, setCaptured] = useState<CapturedPage | null>(null);
  const [highlights, setHighlights] = useState<StoredHighlight[]>([]);
  useEffect(() => {
    const refresh = () => void activePage().then((p) => setPage((old) => (old?.url === p?.url && old?.title === p?.title && old?.tabId === p?.tabId ? old : p)));
    refresh();
    const onUpdated = (_id: number, change: { url?: string; title?: string; status?: string }) => (change.url || change.title || change.status === "complete") && refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(refresh);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(refresh);
    };
  }, []);
  useEffect(() => {
    if (!page) {
      setInfo(null);
      setCaptured(null);
      setHighlights([]);
      return;
    }
    let alive = true;
    const load = () => {
      void findCapture(chromeStore, page.url).then((c) => alive && setCaptured(c));
      void loadPageHighlights(chromeStore, page.url).then((h) => alive && setHighlights(h));
    };
    load();
    void pageInfo(page.tabId, true).then((i) => alive && setInfo(i));
    chrome.storage.onChanged.addListener(load);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(load);
    };
  }, [page]);
  return { page, info, captured, highlights };
}

function RuheApp({ settings }: { settings: ExtensionSettings }) {
  const theme = useResolvedTheme(settings.theme);
  const state = usePageState();
  const { value: prompts } = useLive(loadPrompts, NO_PROMPTS);
  const promptSync = useLibrarySync("prompt");
  const deps: SidePanelDeps = {
    ...state,
    ask: (body, onUpdate, signal) => askKortex(body, { settings, onUpdate, signal }),
    search: (q) => api.searchItems(q, 5),
    send: sendViaBackground,
    focusHighlight: (id) => state.page && void focusHighlightInTab(state.page.tabId, id),
    takeDraft,
    openUrl: (url) => void chrome.tabs.create({ url }),
    openManager: () => void openManagerViaBackground(),
    openOptions: () => void chrome.runtime.openOptionsPage(),
    connected: !isMockMode(settings) && !!settings.token.trim(),
    prompts,
    promptSync,
    tabsView: <RuheTabsPanel baseUrl={settings.baseUrl} theme={theme} />,
  };
  return (
    <ThemeRoot theme={settings.theme} look="ruhe">
      <RuheSidePanel deps={deps} settings={settings} />
    </ThemeRoot>
  );
}

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>("sessions");
  useEffect(() => void loadSettings(chromeStore).then(setSettings), []);
  useDocumentTheme(settings.theme, settings.look);
  const theme = useResolvedTheme(settings.theme);
  if (settings.look === "ruhe") return <RuheApp settings={settings} />;
  // Roving focus like any tablist: arrows switch the view.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: View = view === "sessions" ? "prompts" : "sessions";
    setView(next);
    requestAnimationFrame(() => document.getElementById(`kx-view-${next}`)?.focus());
  };
  return (
    <ThemeRoot theme={settings.theme} className="kx-sp-shell min-h-screen bg-main-window">
      <div className="kx-sp-grid grid gap-3">
        <div className="kx-sp-top">
          <AppMark size={18} />
          <div role="tablist" aria-label={t("View")} className="kx-sp-views" onKeyDown={onKey}>
            {VIEWS.map((v) => (
              <button
                key={v.value}
                id={`kx-view-${v.value}`}
                type="button"
                role="tab"
                className="kx-sp-view"
                aria-selected={view === v.value}
                aria-controls="kx-view-panel"
                tabIndex={view === v.value ? 0 : -1}
                onClick={() => setView(v.value)}
              >
                {v.icon}
                {v.label}
              </button>
            ))}
          </div>
          <span className="kxh-grow" />
          <Button size="icon-sm" variant="ghost" aria-label={t("Open tab manager in full screen")} title={t("Open tab manager in full screen")} onClick={() => void openManagerViaBackground()}>
            <Maximize2 />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={t("Open options")} title={t("Open options")} onClick={() => void chrome.runtime.openOptionsPage()}>
            <Settings2 />
          </Button>
        </div>
        <div id="kx-view-panel" role="tabpanel" aria-labelledby={`kx-view-${view}`} className="min-w-0">
          {view === "sessions" ? <SessionsPanel baseUrl={settings.baseUrl} theme={theme} /> : <Prompts />}
        </div>
      </div>
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
