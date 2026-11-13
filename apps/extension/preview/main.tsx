// Dev preview: the real extension components staged like design/reference/Extension.dc.html.
// Open with `pnpm --filter @kortex/extension preview`; query: ?theme=light&mode=clip|hl|chat&bot=claude|chatgpt
import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, ChevronRight, Copy, Lock, Puzzle, RotateCw, Sparkles, Star } from "lucide-react";
import { AppMark, Button, Kbd, SegmentedTabs } from "@kortex/ui";
import "./stage.css";
import type { SubmitResult } from "../src/lib/outbox";
import type { PageMeta } from "../src/lib/page-meta";
import type { IngestSender } from "../src/lib/messages";
import { mockIngest } from "../src/lib/api";
import { DEFAULT_SETTINGS, type ThemeSetting } from "../src/lib/settings";
import { SaveAnswerButton, SaveChatButton, type SaveState } from "../src/ui/ChatControls";
import { ClipperPanel } from "../src/ui/ClipperPanel";
import { SelectionToolbar } from "../src/ui/SelectionToolbar";
import { ThemeRoot } from "../src/ui/ThemeRoot";
import { Toast, type ToastMessage } from "../src/ui/Toast";

const params = new URLSearchParams(location.search);
const theme = (params.get("theme") === "light" ? "light" : "dark") as ThemeSetting;
type Mode = "clip" | "hl" | "chat";
type Bot = "claude" | "chatgpt";

const PAGE: PageMeta = {
  url: "https://engineering-notes.dev/contextual-retrieval",
  title: "Contextual Retrieval in der Praxis: Warum Chunks ihren Kontext brauchen",
  description: "Die meisten RAG-Systeme scheitern nicht am Modell, sondern an den Bruchstücken, die sie ihm zeigen.",
  image_url: "/dce371d5fe87d39ead096ad81beaa92b.webp",
  site_name: "engineering-notes.dev",
  domain: "engineering-notes.dev",
  reading_minutes: 8,
  keywords: ["mcp", "strategy", "automotive"],
};

const SUGGESTIONS = ["ai/mcp", "strategy/mba", "automotive/it"]; // the prototype's mock suggestions

// Same staging as the prototype: pretend the server takes ~1.3 s.
const send: IngestSender = (req) =>
  new Promise<SubmitResult>((resolve) =>
    setTimeout(() => resolve({ ok: true, delivered: true, response: mockIngest(req) }), 1300),
  );

const fileFor = (bot: Bot) => (bot === "claude" ? "2026-10-22_claude-rag-chunking.md" : "2026-10-22_chatgpt-rag-chunking.md");

function Stage() {
  const [mode, setMode] = useState<Mode>((params.get("mode") as Mode) ?? "clip");
  const [clipOpen, setClipOpen] = useState(mode === "clip");
  const [clipKey, setClipKey] = useState(0);
  const [bot, setBot] = useState<Bot>((params.get("bot") as Bot) ?? "claude");
  const [sel, setSel] = useState(mode === "hl");
  const [hlSaved, setHlSaved] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [chat, setChat] = useState<SaveState>({ status: "idle" });
  const [a1, setA1] = useState<SaveState>({ status: "idle" });
  const [a2, setA2] = useState<SaveState>({ status: "idle" });
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const clear = useCallback(() => setToast(null), []);
  const say = (text: string) => setToast({ text });

  const page = mode === "chat" ? "chat" : "article";
  const claude = bot === "claude";
  const botName = claude ? "Claude" : "ChatGPT";
  const pick = (m: Mode) => {
    setMode(m);
    setClipOpen(m === "clip");
    setClipKey((k) => k + 1);
    setSel(m === "hl");
    setAskOpen(false);
  };
  const reset = (b: Bot) => {
    setBot(b);
    setChat({ status: "idle" });
    setA1({ status: "idle" });
    setA2({ status: "idle" });
  };
  const saved = (file: string): SaveState => ({ status: "saved", file });

  return (
    <ThemeRoot
      theme={theme}
      style={{
        position: "relative",
        height: 900,
        overflow: "hidden",
        background: "radial-gradient(900px 520px at 20% 10%, var(--accent-ai-soft), transparent 70%), var(--bg-app-shell)",
        color: "var(--text-primary)",
      }}
    >
      {/* Touchpoint-Umschalter */}
      <div
        style={{
          position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 40, display: "flex", alignItems: "center", gap: 10,
          padding: "5px 12px 5px 14px", borderRadius: "var(--radius-pill)", background: "var(--bg-floating-glass)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)", backdropFilter: "blur(16px) saturate(160%)", boxShadow: "var(--shadow-floating)",
        }}
      >
        <span className="kx-eyebrow">WXT-Extension</span>
        <SegmentedTabs<Mode>
          size="sm"
          aria-label="Touchpoint"
          className="kx-tabs-touch-36"
          value={mode}
          onChange={pick}
          tabs={[
            { value: "clip", label: "Alt+K Clipper" },
            { value: "hl", label: "Inline-Highlighter" },
            { value: "chat", label: "Chat speichern" },
          ]}
        />
        <span className="kx-keys">
          <Kbd>Alt</Kbd>
          <Kbd>K</Kbd>
        </span>
      </div>

      {/* Browserfenster */}
      <div className="kx-window" style={{ position: "absolute", left: 40, right: 40, top: 56, bottom: 24 }}>
        <div className="kx-doctabs" style={{ height: 38, paddingTop: 6, background: "var(--bg-app-shell)" }}>
          <div className="kx-doctab" role="tab" aria-selected={page === "article"} tabIndex={0} onClick={() => pick("hl")}>
            <span className="kx-truncate">Contextual Retrieval in der Praxis</span>
          </div>
          <div className="kx-doctab" role="tab" aria-selected={page === "chat"} tabIndex={0} onClick={() => pick("chat")}>
            <span className="kx-truncate">{botName}: RAG und Chunking</span>
          </div>
        </div>
        <div className="kxh-row" style={{ height: 44, padding: "0 12px", gap: 6, background: "var(--bg-main-window)", boxShadow: "inset 0 -1px 0 0 var(--border-subtle)" }}>
          <Button variant="ghost" size="icon" aria-label="Zurück"><ChevronLeft /></Button>
          <Button variant="ghost" size="icon" aria-label="Vor"><ChevronRight /></Button>
          <Button variant="ghost" size="icon" aria-label="Neu laden"><RotateCw /></Button>
          <div className="kx-clip-field kxh-grow" style={{ borderRadius: "var(--radius-pill)", minHeight: 34 }}>
            <Lock className="size-3.5 shrink-0" aria-hidden />
            <span className="kx-mono" style={{ fontSize: 12.5 }}>
              {page === "chat" ? (claude ? "claude.ai/chat/rag-chunking" : "chatgpt.com/c/rag-chunking") : "engineering-notes.dev/contextual-retrieval"}
            </span>
          </div>
          <Button variant="ghost" size="icon" aria-label="Lesezeichen"><Star /></Button>
          <Button variant="ghost" size="icon" aria-label="Erweiterungen"><Puzzle /></Button>
          <Button variant="ghost" size="icon" aria-label="Kortex Clipper öffnen" aria-pressed={clipOpen} className="min-h-11 min-w-11" onClick={() => { setClipOpen((o) => !o); setClipKey((k) => k + 1); }}>
            <AppMark size={20} />
          </Button>
        </div>

        <div style={{ position: "relative", flex: 1, minHeight: 0, background: "var(--bg-main-window)" }}>
          {page === "article" && (
            <div className="kx-scroll" style={{ position: "absolute", inset: 0 }}>
              <div style={{ height: 260, position: "relative", overflow: "hidden" }}>
                <img className="kx-photo" src="/dce371d5fe87d39ead096ad81beaa92b.webp" alt="" />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 40%, var(--bg-main-window) 100%)" }} />
              </div>
              <article style={{ maxWidth: 680, margin: "-40px auto 0", position: "relative", padding: "0 24px 80px", display: "grid", gap: 16 }}>
                <span className="kx-domain">engineering-notes.dev · Mara Voss · 8 Min. Lesezeit</span>
                <h1 className="kx-display" style={{ fontSize: 44, lineHeight: "48px", margin: 0 }}>Contextual Retrieval in der Praxis: Warum Chunks ihren Kontext brauchen</h1>
                <p style={{ fontFamily: "var(--font-display)", fontSize: 19, lineHeight: "30px", margin: 0, color: "var(--text-secondary)" }}>Die meisten RAG-Systeme scheitern nicht am Modell, sondern an den Bruchstücken, die sie ihm zeigen.</p>
                <p style={{ fontFamily: "var(--font-display)", fontSize: 18, lineHeight: "30px", margin: 0 }}>Wer ein langes Dokument in gleich große Stücke schneidet, verliert die Struktur. Ein Absatz über Rückerstattungen sagt ohne Kapitelbezug nicht, für welches Produkt er gilt.</p>
                <div style={{ position: "relative" }}>
                  <p style={{ fontFamily: "var(--font-display)", fontSize: 18, lineHeight: "30px", margin: 0 }}>
                    <button className={`kxb ${hlSaved ? "kx-hl" : sel ? "kx-sel" : ""}`} style={{ font: "inherit", display: "inline", textAlign: "left" }} aria-label="Satz markieren" onClick={() => { setSel((s) => !s); setAskOpen(false); }}>
                      Ein Chunk ohne Kapitelbezug ist für das Retrieval oft nur ein Satz ohne Absender.
                    </button>{" "}
                    Contextual Retrieval stellt deshalb jedem Stück einen kurzen, vom Modell erzeugten Kontext voran, bevor es eingebettet wird.
                  </p>
                  {sel && !hlSaved && (
                    <SelectionToolbar
                      style={{ left: 0, top: -48 }}
                      onHighlight={() => { setHlSaved(true); setSel(false); say("Highlight in Kortex gesichert (Artikel und Web)"); }}
                      onAskAi={() => { setAskOpen(true); setSel(false); }}
                    />
                  )}
                  {askOpen && (
                    <div className="kx-callout kx-slide-up" style={{ marginTop: 12, fontSize: 13.5, lineHeight: "21px" }}>
                      <div className="kx-callout-head"><Sparkles className="size-3.5 shrink-0" aria-hidden />Kortex erklärt</div>
                      Ohne vorangestellten Kontext sieht das Embedding nur den Satz selbst. Mit Kontext enthält es auch Herkunft und Thema und trifft die passende Frage genauer. Dazu passt dein Vault-Eintrag AI_Engineering.pdf, Seite 42.
                    </div>
                  )}
                </div>
                <p style={{ fontFamily: "var(--font-display)", fontSize: 18, lineHeight: "30px", margin: 0 }}>In der Praxis kombiniert man Embeddings mit klassischer Stichwortsuche und einem Reranker. Die Kosten für die Kontextsätze lassen sich über Prompt-Caching klein halten.</p>
              </article>
            </div>
          )}

          {page === "chat" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
              <div className="kxh-row" style={{ height: 52, padding: "0 24px", flex: "none", gap: 12, boxShadow: "inset 0 -1px 0 0 var(--border-subtle)" }}>
                <strong style={{ fontSize: 15 }}>{botName}</strong>
                <span className="kx-modelpill">{claude ? "Claude Sonnet" : "GPT-4o"}</span>
                <SegmentedTabs<Bot>
                  size="sm"
                  aria-label="Chat-Anbieter"
                  className="kx-tabs-touch-36"
                  value={bot}
                  onChange={reset}
                  tabs={[{ value: "claude", label: "Claude" }, { value: "chatgpt", label: "ChatGPT" }]}
                />
                <span className="kxh-grow" />
                <SaveChatButton
                  state={chat}
                  onSave={() => { setChat(saved(fileFor(bot))); setA1(saved(fileFor(bot))); setA2(saved(fileFor(bot))); say("Ganzer Chat nach 40_AI_Memories/ exportiert"); }}
                />
              </div>
              <div className="kx-scroll" style={{ flex: 1, minHeight: 0 }}>
                <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 24px", display: "grid", gap: 18 }}>
                  <div className="kx-bubble kx-bubble--me" style={{ justifySelf: "end" }}>Wie chunke ich lange PDFs für ein RAG-System, ohne Kontext zu verlieren?</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 14.5, lineHeight: "23px" }}>Nutze Contextual Retrieval: Stelle jedem Chunk vor dem Embedding einen kurzen, vom Modell erzeugten Kontextsatz voran. Kombiniere das mit BM25 und einem Reranker. Kapitelgrenzen solltest du als harte Chunk-Grenzen respektieren.</div>
                    <div className="kxh-row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <Button variant="ghost" size="sm" className="min-h-9" aria-label="Antwort kopieren"><Copy />Kopieren</Button>
                      <SaveAnswerButton state={a1.status === "saved" ? { status: "saved", file: "2026-10-22_rag-chunking.md" } : a1} onSave={() => { setA1(saved("2026-10-22_rag-chunking.md")); say("Antwort nach 40_AI_Memories/ gespeichert"); }} />
                    </div>
                  </div>
                  <div className="kx-bubble kx-bubble--me" style={{ justifySelf: "end" }}>Und wie wähle ich die Chunk-Größe?</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 14.5, lineHeight: "23px" }}>Starte bei 300 bis 500 Tokens mit etwa 10 Prozent Overlap und miss Recall@20 auf einem kleinen Goldset aus echten Fragen. Erhöhe die Größe nur, wenn Antworten Zusammenhänge verlieren.</div>
                    <div className="kxh-row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <Button variant="ghost" size="sm" className="min-h-9" aria-label="Antwort kopieren"><Copy />Kopieren</Button>
                      <SaveAnswerButton state={a2.status === "saved" ? { status: "saved", file: "2026-10-22_chunk-groesse.md" } : a2} onSave={() => { setA2(saved("2026-10-22_chunk-groesse.md")); say("Antwort nach 40_AI_Memories/ gespeichert"); }} />
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ flex: "none", maxWidth: 720, width: "100%", margin: "0 auto", padding: "0 24px 20px", boxSizing: "border-box" }}>
                <div className="kx-composer"><textarea aria-label="Nachricht an den Assistenten" placeholder="Nachricht schreiben" /></div>
              </div>
            </div>
          )}

          {clipOpen && (
            <div style={{ position: "absolute", right: 16, top: 8, zIndex: 20 }}>
              <ClipperPanel key={clipKey} page={PAGE} suggestions={SUGGESTIONS} settings={DEFAULT_SETTINGS} send={send} onClose={() => setClipOpen(false)} initialStage={params.get("stage") === "done" ? "done" : "form"} />
            </div>
          )}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 48, left: "50%", marginLeft: -180, zIndex: 50 }}>
        <Toast message={toast} onDone={clear} />
      </div>
    </ThemeRoot>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Stage />
  </StrictMode>,
);
