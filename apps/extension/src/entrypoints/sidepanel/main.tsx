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

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>("sessions");
  useEffect(() => void loadSettings(chromeStore).then(setSettings), []);
  useDocumentTheme(settings.theme);
  const theme = useResolvedTheme(settings.theme);
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
