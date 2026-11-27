// Dev gallery of the Ruhe look (2026-11-27): popup states, side panel with an answer, and the on-page pieces
// (selection bar, note card, highlight list, toasts, chat buttons). One theme per page: `?theme=light|dark`,
// `?part=popup|panel|page`. Fixed-position pieces sit in boxes with a transform, so they stay in their box.
import "./fake-chrome.ts";
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Check, CircleAlert, Highlighter } from "lucide-react";
import "./stage.css";
import { mockIngest, type ApiResult, type ItemStatusInfo } from "../src/lib/api";
import type { IngestSender } from "../src/lib/messages";
import type { StoredHighlight } from "../src/lib/mock-inbox";
import type { PageMeta } from "../src/lib/page-meta";
import { DEFAULT_SETTINGS, type ExtensionSettings, type ThemeSetting } from "../src/lib/settings";
import { SaveAnswerButton, SaveChatButton, SavePromptButton } from "../src/ui/ChatControls";
import { ThemeRoot } from "../src/ui/ThemeRoot";
import { BlockedPanel, CapturePanel, QuickSaved, type PopupActions } from "../src/ui/ruhe/CapturePanel";
import { ToastStack, type RxToast } from "../src/ui/ruhe/kit";
import { HighlightDock, NoteCard, SelectionBar } from "../src/ui/ruhe/OnPage";
import { RuheSidePanel, type SidePanelDeps } from "../src/ui/ruhe/SidePanel";

const params = new URLSearchParams(location.search);
const theme = (params.get("theme") === "light" ? "light" : "dark") as ThemeSetting;
const part = params.get("part") ?? "popup";

const PAGE: PageMeta = {
  url: "https://engineering-notes.dev/contextual-retrieval",
  title: "Contextual Retrieval in der Praxis: Warum Chunks ihren Kontext brauchen",
  description: "Die meisten RAG-Systeme scheitern nicht am Modell, sondern an den Bruchstücken, die sie ihm zeigen.",
  image_url: "/dce371d5fe87d39ead096ad81beaa92b.webp",
  site_name: "engineering-notes.dev",
  domain: "engineering-notes.dev",
  reading_minutes: 8,
  keywords: ["rag", "retrieval"],
};
const LIVE: ExtensionSettings = { ...DEFAULT_SETTINGS, token: "kx_preview", baseUrl: "https://kortex.example.com", mockMode: false, clipFolders: ["30_Clippings", "60_Documents/Artikel"], defaultTags: ["reading/later"] };
const noop = () => {};
const req = { kind: "web_clip" as const, url: PAGE.url, title: PAGE.title, client: { name: "kortex-extension" as const, version: "0" }, captured_at: "2026-11-27T08:00:00Z" };
const delivered = { ok: true, delivered: true, response: { ...mockIngest(req), item_id: "0b6f3c1e-1f7a-4f55-9d3a-2a1c2f0e9b11", status: "processing", folder_path: "00_Inbox" } } as const;
const queued = { ok: true, delivered: false, queued: true, reason: "offline", code: "network" } as const;
const failed = { ok: false, error: { code: "unauthorized", message: "Token abgelehnt (401)." } } as const;
const send: IngestSender = async () => delivered;
let polls = 0;
const fetchStatus = async (id: string): Promise<ApiResult<ItemStatusInfo>> => ({
  ok: true,
  data: { item_id: id, status: ++polls > 1 ? "processed" : "processing", type: "article", title: PAGE.title, folder_path: "30_Clippings/AI/Retrieval" },
});
const actions: PopupActions = {
  send,
  fetchStatus,
  remind: async () => ({ ok: true, data: { remind_at: null } }),
  uploadScreenshot: async () => ({ ...mockIngest(req), type: "image" }),
  highlightSelection: async () => ({ ok: true, text: "x" }),
  openSidePanel: noop,
  openManager: noop,
  openOptions: noop,
  openItem: noop,
  openForm: noop,
  flush: noop,
  close: noop,
};
const SELECTION = "Ein Chunk ohne seinen Kontext ist wie ein Satz ohne Absatz: richtig, aber nicht mehr zu verstehen.";

const Cell = ({ title, children, w = 380, h }: { title: string; children: ReactNode; w?: number; h?: number }) => (
  <figure style={{ margin: 0, display: "grid", gap: 6, alignContent: "start" }}>
    <figcaption style={{ font: "500 11.5px var(--font-sans)", color: "var(--t3)" }}>{title}</figcaption>
    <div style={{ width: w, height: h, position: "relative", transform: "translateZ(0)", overflow: "hidden", borderRadius: 12, background: "var(--lum-1)", boxShadow: "0 0 0 1px var(--hair-strong)" }}>{children}</div>
  </figure>
);

function Popups() {
  return (
    <>
      <Cell title="Formular (verbunden, Auswahl vorhanden)">
        <CapturePanel page={PAGE} settings={LIVE} mock={false} actions={actions} selection={SELECTION} suggestions={["ai/rag", "retrieval"]} recentFolders={["30_Clippings/AI"]} />
      </Cell>
      <Cell title="Ordner-Auswahl" h={560}>
        <CapturePanel page={PAGE} settings={LIVE} mock={false} actions={actions} suggestions={["ai/rag"]} recentFolders={["30_Clippings/AI", "60_Documents/Artikel"]} initial={{ menu: "folder" }} />
      </Cell>
      <Cell title="Gespeichert: der Agent arbeitet">
        <CapturePanel page={PAGE} settings={LIVE} mock={false} actions={actions} initial={{ result: delivered }} />
      </Cell>
      <Cell title="Erinnern" h={520}>
        <CapturePanel page={PAGE} settings={LIVE} mock={false} actions={actions} initial={{ result: delivered, menu: "remind" }} />
      </Cell>
      <Cell title="Schon in Kortex">
        <CapturePanel page={PAGE} settings={LIVE} mock={false} actions={actions} captured={{ item_id: "x", folder_path: "30_Clippings/AI", at: new Date(Date.now() - 3 * 86400e3).toISOString(), tags: ["ai/rag"] }} />
      </Cell>
      <Cell title="Offline: in der Warteschlange">
        <CapturePanel page={PAGE} settings={LIVE} mock={false} actions={actions} queueSize={2} initial={{ result: queued }} />
      </Cell>
      <Cell title="Fehler: Token abgelehnt">
        <CapturePanel page={PAGE} settings={LIVE} mock={false} actions={actions} initial={{ result: failed }} />
      </Cell>
      <Cell title="Autosave: gespeichert">
        <QuickSaved page={PAGE} result={delivered} mock={false} actions={actions} />
      </Cell>
      <Cell title="Nicht erfassbar">
        <BlockedPanel actions={actions} settings={LIVE} reason="Diese Seite lässt sich nicht erfassen." />
      </Cell>
    </>
  );
}

const ANSWER = "Weil ein Chunk allein seinen Bezug verliert [1]. Contextual Retrieval stellt jedem Chunk eine kurze Einordnung voran, bevor er eingebettet wird; zusammen mit BM25 sinkt die Fehlerrate beim Abruf deutlich [2].";
const stored = (id: string, exact: string, color: string, note?: string): StoredHighlight => ({
  id,
  color,
  note,
  savedAt: "2026-11-27T08:00:00Z",
  locator: { v: 1, quote: { exact, prefix: "", suffix: "" }, position: { start: 0, end: 0 }, range: { startXPath: "", startOffset: 0, endXPath: "", endOffset: 0 } },
});
const panelDeps: SidePanelDeps = {
  page: { tabId: 1, windowId: 1, url: PAGE.url, title: PAGE.title },
  info: {
    url: PAGE.url,
    selection: "",
    image: PAGE.image_url ?? undefined,
    highlights: [
      { id: "h1", quote: SELECTION, color: "yellow", saved: true, note: "Für den Vortrag" },
      { id: "h2", quote: "Kontextuelle Embeddings senken die Fehlerrate beim Abruf um 35 Prozent.", color: "indigo", saved: true },
    ],
  },
  captured: { item_id: "0b6f3c1e-1f7a-4f55-9d3a-2a1c2f0e9b11", folder_path: "30_Clippings/AI/Retrieval", at: new Date(Date.now() - 3 * 86400e3).toISOString(), tags: ["ai/rag"] },
  highlights: [
    stored("h1", SELECTION, "yellow", "Für den Vortrag"),
    stored("h2", "Kontextuelle Embeddings senken die Fehlerrate beim Abruf um 35 Prozent.", "indigo"),
  ],
  ask: async (_body, onUpdate) => {
    const answer = { text: ANSWER, citations: [{ n: 1, item_id: "a", title: "Chunking-Strategien im Vergleich" }, { n: 2, item_id: "b", title: "Hybrid Search mit pgvector" }], error: null };
    onUpdate(answer);
    return { ok: true, answer };
  },
  search: async () => ({
    ok: true,
    data: [
      { item_id: "a", title: "Chunking-Strategien im Vergleich", type: "article", folder_path: "30_Clippings/AI", source_url: "https://x.dev/a", tags: [] },
      { item_id: "b", title: "Hybrid Search mit pgvector", type: "note", folder_path: "10_Notes", source_url: null, tags: [] },
    ],
  }),
  send,
  focusHighlight: noop,
  openUrl: noop,
  openManager: noop,
  openOptions: noop,
  connected: true,
  prompts: [],
  promptSync: { sync: null, busy: false, refresh: noop },
  tabsView: null,
};

function Panel() {
  return (
    <>
      <Cell title="Seitenleiste: diese Seite" w={400} h={760}>
        <RuheSidePanel deps={panelDeps} settings={LIVE} />
      </Cell>
      <Cell title="Seitenleiste: nicht gespeichert" w={400} h={760}>
        <RuheSidePanel deps={{ ...panelDeps, captured: null, highlights: [], info: { ...panelDeps.info!, highlights: [] } }} settings={LIVE} />
      </Cell>
    </>
  );
}

function OnPage() {
  const [color, setColor] = useState<"yellow" | "indigo" | "green" | "pink">("yellow");
  const toasts: RxToast[] = [
    { id: "1", tone: "busy", text: "Markierung wird gespeichert …" },
    { id: "2", tone: "ok", text: "Markiert in Kortex", detail: "Artikel und Web", action: { label: "Rückgängig", kbd: "⌘Z", onClick: noop } },
    { id: "3", tone: "error", text: "Kortex nicht erreichbar", detail: "Wird später gesendet" },
  ];
  return (
    <div className="rx" data-theme={theme} style={{ display: "contents" }}>
      <Cell title="Auswahl-Leiste" w={520} h={80}>
        <SelectionBar kind="new" color={color} onColor={setColor} onHighlight={noop} onNote={noop} onAsk={noop} onSavePrompt={noop} style={{ left: 12, top: 20 }} />
      </Cell>
      <Cell title="Markierung angeklickt" w={520} h={80}>
        <SelectionBar kind="mark" color="indigo" onColor={noop} onNote={noop} onAsk={noop} onRemove={noop} style={{ left: 12, top: 20 }} />
      </Cell>
      <Cell title="Notiz zur Markierung" w={380} h={250}>
        <NoteCard quote={SELECTION} color="green" note="" onSave={noop} onCancel={noop} onDelete={noop} style={{ left: 12, top: 12, width: 340 }} />
      </Cell>
      <Cell title="Markierungen der Seite" w={380} h={360}>
        <DockOpen />
      </Cell>
      <Cell title="Rückmeldungen" w={460} h={190}>
        <ToastStack toasts={toasts} onDismiss={noop} />
      </Cell>
      <Cell title="ChatGPT / Claude" w={460} h={70}>
        <div style={{ display: "flex", gap: 8, padding: 16, flexWrap: "wrap" }}>
          <SaveChatButton ruhe state={{ status: "idle" }} onSave={noop} />
          <SaveAnswerButton ruhe state={{ status: "saved", file: "x.md" }} onSave={noop} />
          <SavePromptButton ruhe state={{ status: "idle" }} onSave={noop} />
        </div>
      </Cell>
      <Cell title="Symbole" w={200} h={70}>
        <div style={{ display: "flex", gap: 12, padding: 20, color: "var(--t2)" }}>
          <Check /> <CircleAlert /> <Highlighter />
        </div>
      </Cell>
    </div>
  );
}

function DockOpen() {
  // The dock opens on click; the preview clicks it once after mounting.
  return (
    <div ref={(el) => void setTimeout(() => el?.querySelector<HTMLButtonElement>(".rx-fab[aria-expanded=false]")?.click(), 300)}>
      <HighlightDock
        items={[
          { id: "h1", quote: SELECTION, note: "Für den Vortrag", color: "yellow", saved: true },
          { id: "h2", quote: "Kontextuelle Embeddings senken die Fehlerrate beim Abruf um 35 Prozent.", color: "indigo", saved: true },
          { id: "h3", quote: "BM25 und Embeddings zusammen schlagen jedes allein.", color: "green", saved: false },
        ]}
        onJump={noop}
        onOpenPanel={noop}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeRoot theme={theme} look="ruhe">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start", padding: 20, minHeight: "100vh", background: "var(--lum-0)" }}>
        {part === "panel" ? <Panel /> : part === "page" ? <OnPage /> : <Popups />}
      </div>
    </ThemeRoot>
  </StrictMode>,
);
