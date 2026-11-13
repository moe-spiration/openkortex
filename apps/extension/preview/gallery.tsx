// Dev gallery: every state of the extension UI (popup clipper, status chips, highlighter, chat
// buttons, toast) in dark and light, side by side. Open /gallery.html; `?only=dark|light`.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./stage.css";
import { mockIngest, type ApiResult, type ItemStatusInfo } from "../src/lib/api";
import type { IngestSender } from "../src/lib/messages";
import type { PageMeta } from "../src/lib/page-meta";
import { DEFAULT_SETTINGS, type ThemeSetting } from "../src/lib/settings";
import { SaveAnswerButton, SaveChatButton } from "../src/ui/ChatControls";
import { ClipperPanel } from "../src/ui/ClipperPanel";
import { QuickSave } from "../src/ui/QuickSave";
import { SelectionToolbar } from "../src/ui/SelectionToolbar";
import { SessionsPanel } from "../src/ui/SessionsPanel";
import { StatusChip } from "../src/ui/StatusChip";
import { Toast } from "../src/ui/Toast";
import { ThemeRoot } from "../src/ui/ThemeRoot";

const PAGE: PageMeta = {
  url: "https://engineering-notes.dev/contextual-retrieval",
  title: "Contextual Retrieval in der Praxis: Warum Chunks ihren Kontext brauchen",
  description: "RAG",
  image_url: "/dce371d5fe87d39ead096ad81beaa92b.webp",
  site_name: "engineering-notes.dev",
  domain: "engineering-notes.dev",
  reading_minutes: 8,
  keywords: [],
};
const NO_IMAGE: PageMeta = { ...PAGE, image_url: null };
const VIDEO: PageMeta = {
  ...PAGE,
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Rick Astley - Never Gonna Give You Up (Official Video)",
  domain: "youtube.com",
  image_candidates: [PAGE.image_url!, PAGE.image_url! + "?b", PAGE.image_url! + "?c"],
  media: { kind: "video", provider: "youtube", duration_sec: 213, channel: "Rick Astley" },
  transcript: { text: "…", lang: "de", source: "youtube-captions", segments: [{ start: 0, dur: 213, text: "…" }] },
};
const VIDEO_NO_CAPTIONS: PageMeta = { ...VIDEO, transcript: undefined, capture_notes: ["Keine Untertitel gefunden"] };
const SUGGESTIONS = ["ai/mcp", "strategy/mba", "automotive/it"];
const send: IngestSender = async (r) => ({ ok: true, delivered: true, response: mockIngest(r) });
const fail: IngestSender = async () => ({ ok: false, error: { code: "unauthorized", message: "x" } });
const offline: IngestSender = async () => ({ ok: true, delivered: false, queued: true, reason: "offline", code: "network" });
const noop = () => {};
const delivered = (over: Partial<ReturnType<typeof mockIngest>> = {}) =>
  ({ ok: true, delivered: true, response: { ...mockIngest({ kind: "web_clip", url: PAGE.url, title: PAGE.title, client: { name: "kortex-extension", version: "0" }, captured_at: "2026-10-24T08:00:00Z" }), ...over } }) as const;
const statusOf = (status: ItemStatusInfo["status"]) => async (id: string): Promise<ApiResult<ItemStatusInfo>> => ({
  ok: true,
  data: { item_id: id, status, type: "article", title: PAGE.title, folder_path: "30_Clippings/AI" },
});

// Side-panel sessions read chrome.storage/tabs: a tiny in-memory stand-in for the preview.
const now = Date.now();
const SESSIONS = [
  {
    id: "s1",
    title: "Recherche RAG · Session 2026-11-01 09:12 (7 Tabs)",
    saved_at: new Date(now - 2 * 3600e3).toISOString(),
    item_id: "demo",
    tabs: [
      { url: "https://www.anthropic.com/news/contextual-retrieval", title: "Introducing Contextual Retrieval", favicon: "https://www.anthropic.com/favicon.ico" },
      { url: "https://github.com/run-llama/llama_index", title: "run-llama/llama_index", favicon: "https://github.com/favicon.ico" },
      { url: "https://arxiv.org/abs/2005.11401", title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" },
      { url: "https://docs.python.org/3/library/asyncio.html", title: "asyncio — Asynchronous I/O" },
      { url: "https://news.ycombinator.com/item?id=1", title: "Ask HN: How do you chunk documents?" },
      { url: "https://www.youtube.com/watch?v=x", title: "RAG from scratch" },
      { url: "https://pgvector.dev/", title: "pgvector" },
    ],
  },
  { id: "s2", title: "Urlaub planen", saved_at: new Date(now - 30 * 3600e3).toISOString(), tabs: [{ url: "https://www.bahn.de/", title: "Bahn" }] },
];
const store: Record<string, unknown> = { "library.sessions": SESSIONS };
const evt = { addListener: noop, removeListener: noop };
const g = globalThis as { chrome?: unknown };
g.chrome ??= {
  storage: { local: { get: async (k: string) => ({ [k]: store[k] }), set: async (o: object) => void Object.assign(store, o), remove: async () => undefined }, onChanged: evt },
  tabs: {
    query: async () => [
      { id: 1, url: "https://engineering-notes.dev/contextual-retrieval", title: PAGE.title, highlighted: true },
      { id: 2, url: "https://github.com/", title: "GitHub", favIconUrl: "https://github.com/favicon.ico" },
      { id: 3, url: "chrome://extensions", title: "Erweiterungen" },
    ],
    create: async () => ({}),
    onCreated: evt,
    onRemoved: evt,
    onUpdated: evt,
  },
  windows: { getCurrent: async () => ({ id: 1 }), create: async () => ({}) },
  runtime: { sendMessage: async () => ({ ok: true, saved: 2, closed: 2 }) },
};

const params = new URLSearchParams(location.search);
const only = params.get("only");
const themes = (only === "dark" || only === "light" ? [only] : ["dark", "light"]) as ThemeSetting[];

function Column({ theme }: { theme: ThemeSetting }) {
  const popup = { page: PAGE, suggestions: SUGGESTIONS, send, onClose: noop, variant: "floating" as const };
  const label = (t: string) => <div className="kx-eyebrow" style={{ margin: "16px 0 6px" }}>{t}</div>;
  return (
    <ThemeRoot theme={theme} style={{ padding: 16, background: "var(--bg-app-shell)", width: 420 }}>
      <div className="kx-eyebrow">{theme}</div>
      {label("Side-Panel: Sessions")}
      <div style={{ padding: 16, background: "var(--bg-main-window)", borderRadius: 16 }}>
        <SessionsPanel baseUrl={DEFAULT_SETTINGS.baseUrl} />
      </div>
      {label("Clipper: Formular, Auto-Routing")}
      <ClipperPanel {...popup} settings={DEFAULT_SETTINGS} />
      {label("Clipper: Video, Cover wählen, Transkript erkannt")}
      <ClipperPanel {...popup} page={VIDEO} settings={DEFAULT_SETTINGS} />
      {label("Clipper: Video ohne Untertitel")}
      <ClipperPanel {...popup} page={VIDEO_NO_CAPTIONS} settings={DEFAULT_SETTINGS} />
      {label("Clipper: Ordner wählen, ohne Bild")}
      <ClipperPanel {...popup} page={NO_IMAGE} settings={{ ...DEFAULT_SETTINGS, defaultRoute: "manual" }} />
      {label("Clipper: Popup mit Zusammenfassung und Autosave (C1, C2)")}
      <ClipperPanel {...popup} variant="popup" settings={{ ...DEFAULT_SETTINGS, summaryLevel: "detailed" }} onSettingsChange={noop} />
      {label("Autosave: gespeichert (C2)")}
      <QuickSave page={PAGE} settings={{ ...DEFAULT_SETTINGS, autosave: true }} send={send} mock onClose={noop} onSettingsChange={noop} autoCloseMs={0} />
      {label("Autosave: offline, wird nachgeliefert (C2)")}
      <QuickSave page={NO_IMAGE} settings={{ ...DEFAULT_SETTINGS, autosave: true }} send={offline} onClose={noop} onSettingsChange={noop} autoCloseMs={0} />
      {label("Autosave: Fehler (C2)")}
      <QuickSave page={NO_IMAGE} settings={{ ...DEFAULT_SETTINGS, autosave: true }} send={fail} onClose={noop} onOpenOptions={noop} onSettingsChange={noop} autoCloseMs={0} />
      {label("Clipper: gespeichert")}
      <ClipperPanel {...popup} settings={DEFAULT_SETTINGS} initialStage="done" />
      {label("Clipper: Server-Antwort, wird verarbeitet")}
      <ClipperPanel {...popup} settings={DEFAULT_SETTINGS} initialStage="done" initialResult={delivered({ status: "processing", queued: true })} fetchStatus={statusOf("processing")} />
      {label("Clipper: Server-Antwort, verarbeitet und einsortiert")}
      <ClipperPanel {...popup} settings={DEFAULT_SETTINGS} initialStage="done" initialResult={delivered({ status: "processing" })} fetchStatus={statusOf("processed")} />
      {label("Clipper: schon angekommen")}
      <ClipperPanel {...popup} settings={DEFAULT_SETTINGS} initialStage="done" initialResult={delivered({ replayed: true })} fetchStatus={statusOf("processed")} />
      {label("Status, Highlighter, Chat")}
      <div style={{ display: "grid", gap: 12, padding: 16, background: "var(--bg-main-window)", borderRadius: 16 }}>
        <div className="kxh-wrap">
          <StatusChip tone="ok">In Kortex Inbox gespeichert</StatusChip>
          <StatusChip tone="warn">Mock-Modus</StatusChip>
          <StatusChip tone="error">Nicht gespeichert</StatusChip>
        </div>
        <div style={{ position: "relative", height: 48 }}>
          <SelectionToolbar onHighlight={noop} onAskAi={noop} style={{ left: 0, top: 4 }} />
        </div>
        <div className="kxh-wrap">
          <SaveChatButton state={{ status: "idle" }} onSave={noop} />
          <SaveAnswerButton state={{ status: "idle" }} onSave={noop} />
          <SaveAnswerButton state={{ status: "saved", file: "2026-10-24_rag.md" }} onSave={noop} />
        </div>
        <Toast message={{ text: "Highlight in Kortex gesichert (Artikel und Web)" }} onDone={noop} ms={1e9} />
        <Toast message={{ text: "Kortex nicht erreichbar", tone: "error" }} onDone={noop} ms={1e9} />
      </div>
      {label("Fehler")}
      <ClipperPanel {...popup} send={fail} settings={DEFAULT_SETTINGS} initialStage="form" />
    </ThemeRoot>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", background: "#888", padding: 16, minHeight: "100vh" }}>
      {themes.map((t) => (
        <Column key={t} theme={t} />
      ))}
    </div>
  </StrictMode>,
);
