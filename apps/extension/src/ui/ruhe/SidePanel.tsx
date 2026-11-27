// Side panel in the Ruhe look (2026-11-27): the companion while reading. Views Page (status, highlights of the
// page, related in Kortex, ask Kortex about the page), Tabs (this window and the sessions) and Prompts; keys 1 to 3.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Brain,
  BookOpen,
  Check,
  Copy,
  FileText,
  Globe,
  Maximize2,
  MessageSquareText,
  NotebookPen,
  PenLine,
  RotateCw,
  Search,
  Settings2,
  Sparkles,
  TextSelect,
  Trash2,
  X,
} from "lucide-react";
import { PRODUCT_NAME, intlLocale, t, tn } from "../../i18n";
import type { ApiResult, IngestRequest, SearchHit } from "../../lib/api";
import { buildAskBody, citedSources, type AskAnswer, type AskFailure, type AskScope, type AskTurn, type PageContext } from "../../lib/ask";
import type { CapturedPage } from "../../lib/captured";
import { deletePromptEntry, searchPrompts, undoPromptDelete, type DeleteUndo, type SavedPrompt } from "../../lib/library";
import type { AskDraft, IngestSender, PageInfo } from "../../lib/messages";
import type { StoredHighlight } from "../../lib/mock-inbox";
import type { PageMeta } from "../../lib/page-meta";
import { fillVariables } from "../../lib/prompts";
import { buildWebClip, defaultClipChoice, EXTENSION_VERSION, newIdempotencyKey } from "../../lib/requests";
import { clientInfo } from "../../lib/api";
import type { SyncState } from "../../lib/library";
import { chromeStore, type ExtensionSettings } from "../../lib/settings";
import { PageCard } from "./CapturePanel";
import { Btn, EmptyState, FolderPath, IconBtn, Kbd, Mark, ToastStack, ViewTabs, isTyping, modKey, useToasts } from "./kit";

export type PanelView = "page" | "tabs" | "prompts";

export interface ActivePage {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl?: string;
}

export interface SidePanelDeps {
  /** The active tab of this window (null on browser pages). */
  page: ActivePage | null;
  info: PageInfo | null;
  captured: CapturedPage | null;
  highlights: StoredHighlight[];
  /** Streams an answer; resolves with the final one or the failure. */
  ask: (body: ReturnType<typeof buildAskBody>, onUpdate: (a: AskAnswer) => void, signal: AbortSignal) => Promise<{ ok: true; answer: AskAnswer } | { ok: false; error: AskFailure }>;
  search?: (query: string) => Promise<ApiResult<SearchHit[]>>;
  send: IngestSender;
  focusHighlight: (id: string) => void;
  /** Question from the page's selection bar, taken once. */
  takeDraft?: () => Promise<AskDraft | null>;
  openUrl: (url: string) => void;
  openManager: () => void;
  openOptions: () => void;
  /** Whether a connected Kortex is set up (asking and related need it). */
  connected: boolean;
  prompts: SavedPrompt[];
  promptSync: { sync: SyncState | null; busy: boolean; refresh: () => void };
  /** The Tabs view (TabBoard with this window and the sessions). */
  tabsView: ReactNode;
}

const timeFmt = (iso: string) => {
  try {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });
  } catch {
    return "";
  }
};

function pageMetaOf(p: ActivePage, info: PageInfo | null): PageMeta {
  let domain = "";
  try {
    domain = new URL(p.url).hostname.replace(/^www\./, "");
  } catch {
    /* keep empty */
  }
  return { url: p.url, title: p.title || domain, description: null, image_url: info?.image ?? null, site_name: null, domain, reading_minutes: null, keywords: [] };
}

const TYPE_ICON: Record<string, ReactNode> = { note: <FileText aria-hidden />, book: <BookOpen aria-hidden />, bookmark: <Globe aria-hidden />, article: <Globe aria-hidden /> };

/* ---------------- Page view ---------------- */

interface Turn {
  q: string;
  a: AskAnswer | null;
  error?: AskFailure;
}

function PageView({ deps, settings }: { deps: SidePanelDeps; settings: ExtensionSettings }) {
  const { page, info, captured, highlights } = deps;
  const meta = useMemo(() => (page ? pageMetaOf(page, info) : null), [page, info]);
  const [related, setRelated] = useState<SearchHit[] | null>(null);
  const [thread, setThread] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [scope, setScope] = useState<AskScope>("page");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const toasts = useToasts();

  // A new page: a fresh thread and new related items.
  useEffect(() => {
    abort.current?.abort();
    setThread([]);
    setRelated(null);
    setSaving("idle");
    if (!page || !deps.search || !deps.connected) return;
    let alive = true;
    void deps.search(page.title).then((r) => alive && setRelated(r.ok ? r.data.filter((h) => h.item_id !== captured?.item_id && h.source_url !== page.url).slice(0, 3) : null));
    return () => {
      alive = false;
    };
  }, [page?.url]);

  // "Ask" in the page's selection bar: the question about the passage waits here (now or when it arrives).
  const take = useRef(deps.takeDraft);
  take.current = deps.takeDraft;
  useEffect(() => {
    const pick = () =>
      void take.current?.().then((d) => {
        if (!d) return;
        setQuote(d.quote || null);
        setScope("page");
        input.current?.focus();
      });
    pick();
    const on = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.askDraft?.newValue) pick();
    };
    try {
      chrome.storage.onChanged.addListener(on);
      return () => chrome.storage.onChanged.removeListener(on);
    } catch {
      return undefined;
    }
  }, []);

  const send = useCallback(async () => {
    const q = draft.trim();
    if (!q || busy || !page) return;
    const history: AskTurn[] = thread.flatMap((x) => (x.a?.text ? [{ role: "user" as const, content: x.q }, { role: "assistant" as const, content: x.a.text }] : []));
    const ctx: PageContext = { url: page.url, title: page.title, text: info?.text, quote: quote ?? undefined, itemId: captured && !captured.local ? captured.item_id : null };
    setDraft("");
    setQuote(null);
    setBusy(true);
    setThread((th) => [...th, { q, a: null }]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const res = await deps.ask(buildAskBody(history, q, ctx, scope), (a) => setThread((th) => th.map((x, i) => (i === th.length - 1 ? { ...x, a } : x))), ctrl.signal);
    setThread((th) => th.map((x, i) => (i === th.length - 1 ? (res.ok ? { ...x, a: res.answer } : { ...x, error: res.error }) : x)));
    setBusy(false);
  }, [draft, busy, page, thread, info, quote, captured, scope, deps]);

  const saveClip = async () => {
    if (!meta) return;
    const res = await deps.send(buildWebClip(meta, defaultClipChoice(meta, settings)));
    toasts.show(res.ok ? { tone: res.delivered ? "ok" : "warn", text: res.delivered ? t("Saved to Kortex") : t("Saved offline, will be sent") } : { tone: "error", text: t("Not saved"), detail: res.error.message });
  };

  const saveAnswer = async (turn: Turn) => {
    if (!turn.a?.text || !page) return;
    setSaving("saving");
    const req: IngestRequest = {
      kind: "note",
      client: clientInfo(EXTENSION_VERSION),
      captured_at: new Date().toISOString(),
      idempotency_key: newIdempotencyKey(),
      title: turn.q.slice(0, 120),
      content_md: `${turn.a.text}\n\n${t("Source: {url}", { url: page.url })}`,
      tags: ["ai/ask"],
    };
    const res = await deps.send(req);
    setSaving(res.ok ? "saved" : "idle");
    if (!res.ok) toasts.show({ tone: "error", text: t("Not saved"), detail: res.error.message });
  };

  // ↵ saves the page while it is not in Kortex yet (outside text fields, before a question was asked).
  const enterSaves = useRef<(() => void) | null>(null);
  enterSaves.current = !captured && meta && thread.length === 0 ? () => void saveClip() : null;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTyping(e) || !enterSaves.current) return;
      if (e.target instanceof HTMLElement && e.target.closest("button, a, [role=tab], [role=menu]")) return;
      e.preventDefault();
      enterSaves.current();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);

  if (!page || !meta) {
    return <EmptyState icon={<Globe aria-hidden />} title={t("No page to show")}>{t("Browser pages cannot be read. Open a website to see its status and highlights here.")}</EmptyState>;
  }

  const composer = (
    <div className="rx-composer">
      {quote && (
        <div className="rx-quote" style={{ margin: "0 0 8px" }}>
          <span className="rx-hl-bar" data-hl="indigo" aria-hidden />
          <span className="rx-clamp2 rx-grow">{quote}</span>
          <IconBtn small label={t("Remove passage")} onClick={() => setQuote(null)}>
            <X />
          </IconBtn>
        </div>
      )}
      <textarea
        ref={input}
        rows={1}
        value={draft}
        placeholder={thread.length ? t("Follow-up …") : t("Ask Kortex about this page …")}
        aria-label={t("Ask Kortex")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="rx-composer-bar">
        <button type="button" className="rx-chip" aria-pressed={scope === "page"} onClick={() => setScope("page")}>
          <FileText aria-hidden /> {t("This page")}
        </button>
        <button type="button" className="rx-chip" aria-pressed={scope === "library"} onClick={() => setScope("library")}>
          <Brain aria-hidden /> {t("Library")}
        </button>
        <span className="rx-grow" />
        {busy ? (
          <IconBtn small label={t("Stop")} onClick={() => abort.current?.abort()}>
            <X />
          </IconBtn>
        ) : null}
        <button type="button" className="rx-send" aria-label={t("Send")} title={t("Send")} disabled={!draft.trim() || busy} onClick={() => void send()}>
          <ArrowUp aria-hidden />
        </button>
      </div>
    </div>
  );

  if (thread.length) {
    return (
      <>
        <div style={{ padding: "10px 14px 8px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid var(--hair)" }}>
          <div className="rx-cover rx-cover--sm">{meta.image_url ? <img src={meta.image_url} alt="" referrerPolicy="no-referrer" /> : meta.domain.slice(0, 1).toUpperCase()}</div>
          <span className="rx-trunc" style={{ fontWeight: 500, fontSize: 12.5 }}>
            {meta.title}
          </span>
          <span className="rx-grow" />
          <span className="rx-faint" style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center", whiteSpace: "nowrap" }}>
            <span className={`rx-dot ${captured ? "rx-dot--ok" : "rx-dot--off"}`} aria-hidden /> {captured ? t("saved") : t("not saved")}
          </span>
          <IconBtn small label={t("New question")} onClick={() => setThread([])}>
            <X />
          </IconBtn>
        </div>
        <div className="rx-sp-scroll" style={{ overflow: "auto" }}>
          <div className="rx-thread">
            {thread.map((x, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="rx-q">{x.q}</div>
                {x.error ? (
                  <div className="rx-banner rx-banner--crit" role="alert">
                    <Sparkles aria-hidden />
                    <div className="rx-grow">
                      <b>{x.error.code === "forbidden" ? t("This token may not ask") : x.error.code === "setup_required" ? t("Not connected") : t("No answer")}</b>
                      {x.error.message}
                    </div>
                    {(x.error.code === "forbidden" || x.error.code === "setup_required" || x.error.code === "unauthorized") && (
                      <button type="button" className="rx-banner-act" onClick={deps.openOptions}>
                        {t("Options")}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rx-answer" aria-live="polite">
                    <div className="rx-lab" style={{ minHeight: 22 }}>
                      <Sparkles aria-hidden /> {PRODUCT_NAME}{" "}
                      {x.a?.citations.length ? <span className="rx-c">{tn(citedSources(x.a).length, "from {n} source", "from {n} sources")}</span> : null}
                    </div>
                    {x.a?.text || <span className="rx-faint">{t("Thinking …")}</span>}
                    {x.a?.error && <div className="rx-btn--crit" style={{ marginTop: 6 }}>{x.a.error}</div>}
                  </div>
                )}
                {x.a && !busy && citedSources(x.a).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, margin: "0 -8px" }}>
                    {citedSources(x.a).map((c) => (
                      <button key={c.n} type="button" className="rx-row" onClick={() => deps.openUrl(`${settings.baseUrl.replace(/\/+$/, "")}/notes/${encodeURIComponent(c.item_id)}`)}>
                        <span className="rx-fav rx-num">{c.n}</span>
                        <span className="rx-row-t">{c.title}</span>
                      </button>
                    ))}
                  </div>
                )}
                {x.a?.text && !busy && i === thread.length - 1 && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn variant="line" disabled={saving !== "idle"} onClick={() => void saveAnswer(x)}>
                      {saving === "saved" ? <Check /> : <NotebookPen />} {saving === "saved" ? t("Saved as note") : t("Save as note")}
                    </Btn>
                    <Btn onClick={() => void navigator.clipboard?.writeText(x.a!.text).catch(() => undefined)}>
                      <Copy /> {t("Copy")}
                    </Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {composer}
        <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
      </>
    );
  }

  return (
    <>
      <PageCard page={meta} cover={meta.image_url} meta={captured ? undefined : `${meta.domain} · ${t("not saved")}`} />
      {captured ? (
        <div className="rx-sp-status" role="status">
          <span className="rx-dot rx-dot--ok" aria-hidden />
          <span className="rx-trunc">
            {captured.local ? t("Saved locally in") : t("Saved in")} <FolderPath path={captured.folder_path} />
          </span>
          <span className="rx-grow" />
          <span className="rx-num rx-faint">{timeFmt(captured.at)}</span>
        </div>
      ) : (
        <div style={{ padding: "0 14px" }}>
          <Btn variant="pri" block kbd="↵" onClick={() => void saveClip()}>
            {t("Save page")}
          </Btn>
        </div>
      )}
      <div className="rx-sp-scroll" style={{ overflow: "auto" }}>
        <div className="rx-lab" style={{ padding: "6px 8px 0" }}>
          {t("Highlights")} <span className="rx-c rx-num">{highlights.length}</span>
        </div>
        {highlights.length === 0 ? (
          <div className="rx-muted" style={{ fontSize: 12.5, padding: "2px 8px 10px" }}>
            {t("Select text on the page and it shows up here.")} <Kbd>H</Kbd> {t("highlights the selection,")} <Kbd>N</Kbd> {t("with a note.")}
          </div>
        ) : (
          highlights.map((h) => (
            <button key={h.id} type="button" className="rx-hl" data-hl={h.color ?? "yellow"} onClick={() => deps.focusHighlight(h.id)} title={t("Show on the page")}>
              <span className="rx-hl-bar" aria-hidden />
              <span style={{ minWidth: 0 }}>
                <span className="rx-hl-q rx-clamp2">{h.locator.quote.exact}</span>
                {h.note && (
                  <span className="rx-hl-n">
                    <PenLine aria-hidden />
                    <span className="rx-trunc">{h.note}</span>
                  </span>
                )}
              </span>
            </button>
          ))
        )}
        {related && related.length > 0 && (
          <>
            <div className="rx-lab" style={{ padding: "0 8px", marginTop: 10 }}>
              {t("Related in Kortex")} <span className="rx-c rx-num">{related.length}</span>
            </div>
            {related.map((r) => (
              <button key={r.item_id} type="button" className="rx-row" onClick={() => deps.openUrl(`${settings.baseUrl.replace(/\/+$/, "")}/notes/${encodeURIComponent(r.item_id)}`)}>
                {TYPE_ICON[r.type] ?? <FileText aria-hidden />}
                <span className="rx-row-t">{r.title}</span>
                <span className="rx-row-r">{r.folder_path?.split("/").pop()}</span>
              </button>
            ))}
          </>
        )}
      </div>
      {composer}
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </>
  );
}


/* ---------------- Prompts view ---------------- */

function PromptRow({ p, open, onToggle, onDelete }: { p: SavedPrompt; open: boolean; onToggle: () => void; onDelete: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const text = p.variables.length ? fillVariables(p.text, values) : p.text;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied */
    }
  };
  if (!open) {
    return (
      <button type="button" className="rx-prompt" onClick={onToggle} aria-expanded={false}>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="rx-trunc" style={{ fontWeight: 500 }}>
            {p.title}
          </span>
          <span className="rx-grow" />
          <span className="rx-faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
            {p.variables.length ? tn(p.variables.length, "{n} variable", "{n} variables") : timeFmt(p.saved_at)}
          </span>
        </span>
        <span className="rx-muted rx-trunc" style={{ display: "block", fontSize: 12.5 }}>
          {p.text}
        </span>
      </button>
    );
  }
  const removeLabel = p.item_id ? t("Remove from the list (stays in Kortex)") : t("Remove from list");
  return (
    <div
      className="rx-prompt"
      data-open=""
      onKeyDown={(e) => {
        if (modKey(e) && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
          e.preventDefault();
          void copy();
        } else if (e.key === "Escape") onToggle();
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="rx-trunc" style={{ fontWeight: 500 }} onClick={onToggle} aria-expanded>
          {p.title}
        </button>
        <span className="rx-grow" />
        <IconBtn small label={removeLabel} onClick={onDelete}>
          <Trash2 />
        </IconBtn>
      </div>
      <div className="rx-muted" style={{ fontSize: 12.5, margin: "2px 0 10px", whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>
        {p.text}
      </div>
      {p.variables.length > 0 && (
        <div className="rx-prompt-vars">
          {p.variables.map((v, i) => (
            <label key={v} style={{ display: "contents" }}>
              <span className="rx-muted rx-trunc">{v}</span>
              <span className="rx-field">
                <input autoFocus={i === 0} value={values[v] ?? ""} aria-label={v} onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))} />
              </span>
            </label>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <Btn variant="pri" kbd={copied ? undefined : "⌘C"} onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? t("Copied") : t("Copy")}
        </Btn>
      </div>
    </div>
  );
}

function SyncDot({ sync, busy, onRefresh }: { sync: SyncState | null; busy: boolean; onRefresh: () => void }) {
  const ok = sync?.state === "synced";
  const text = busy || !sync ? t("Syncing …") : ok ? t("synced") : sync.state === "offline" ? t("offline") : sync.state === "error" ? t("local only") : t("local");
  return (
    <span className="rx-faint" style={{ fontSize: 11.5, fontWeight: 400, display: "flex", gap: 5, alignItems: "center" }} title={sync?.state === "error" ? sync.message : undefined}>
      <span className={`rx-dot ${ok ? "rx-dot--ok" : "rx-dot--off"}`} aria-hidden />
      {text}
      <IconBtn small label={t("Sync with Kortex")} disabled={busy} onClick={onRefresh}>
        <RotateCw />
      </IconBtn>
    </span>
  );
}

export function RxSearch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);
  return (
    <label className="rx-field">
      <Search aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={label}
        aria-label={label}
        aria-keyshortcuts="/"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && (e.preventDefault(), onChange(""))}
      />
      {value ? (
        <IconBtn small label={t("Clear search")} onClick={() => (onChange(""), ref.current?.focus())}>
          <X />
        </IconBtn>
      ) : (
        <Kbd>/</Kbd>
      )}
    </label>
  );
}

function PromptsView({ deps }: { deps: SidePanelDeps }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const toasts = useToasts();
  const shown = searchPrompts(deps.prompts, q);
  const remove = async (p: SavedPrompt) => {
    const token: DeleteUndo<SavedPrompt> = await deletePromptEntry(chromeStore, p);
    toasts.show({ tone: "ok", text: t("“{title}” removed", { title: p.title }), action: { label: t("Undo"), onClick: () => void undoPromptDelete(chromeStore, token) } });
  };
  return (
    <>
      <div style={{ padding: "10px 12px 4px" }}>
        <RxSearch value={q} onChange={setQ} label={t("Search prompts")} />
      </div>
      <div className="rx-lab" style={{ padding: "0 14px" }}>
        {t("Prompts")} <span className="rx-c rx-num">{deps.prompts.length}</span>
        <span className="rx-grow" />
        <SyncDot sync={deps.promptSync.sync} busy={deps.promptSync.busy} onRefresh={deps.promptSync.refresh} />
      </div>
      <div className="rx-sp-scroll" style={{ overflow: "auto", paddingTop: 0 }}>
        {shown.map((p) => (
          <PromptRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onDelete={() => void remove(p)} />
        ))}
        {shown.length === 0 && (
          <EmptyState icon={<MessageSquareText aria-hidden />} title={deps.prompts.length ? t("No matches.") : t("No prompts yet")}>
            {deps.prompts.length ? undefined : t("Save one below a user message in ChatGPT/Claude or by right-clicking selected text.")}
          </EmptyState>
        )}
      </div>
      <div className="rx-hints" style={{ padding: "10px 14px", borderTop: "1px solid var(--hair)" }}>
        <span>
          <TextSelect size={12} aria-hidden />
          {t("New prompt: select text, right-click, “Save as prompt”")}
        </span>
      </div>
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </>
  );
}

/* ---------------- shell ---------------- */

export function RuheSidePanel({ deps, settings, initialView = "page" }: { deps: SidePanelDeps; settings: ExtensionSettings; initialView?: PanelView }) {
  const [view, setView] = useState<PanelView>(initialView);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const next = ({ "1": "page", "2": "tabs", "3": "prompts" } as const)[e.key as "1"];
      if (next) {
        e.preventDefault();
        setView(next);
      }
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);
  // A question from the page switches to the page view.
  useEffect(() => {
    const on = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.askDraft?.newValue) setView("page");
    };
    try {
      chrome.storage.onChanged.addListener(on);
      return () => chrome.storage.onChanged.removeListener(on);
    } catch {
      return undefined;
    }
  }, []);
  return (
    <div className="rx rx-sp">
      <header className="rx-loc rx-sp-head">
        <Mark />
        <ViewTabs<PanelView>
          label={t("View")}
          value={view}
          onChange={setView}
          tabs={[
            { value: "page", label: t("Page"), kbd: "1" },
            { value: "tabs", label: t("Tabs"), kbd: "2" },
            { value: "prompts", label: t("Prompts"), kbd: "3" },
          ]}
        />
        <span className="rx-grow" />
        <IconBtn label={t("Open tab manager in full screen")} onClick={deps.openManager}>
          <Maximize2 />
        </IconBtn>
        <IconBtn label={t("Open options")} onClick={deps.openOptions}>
          <Settings2 />
        </IconBtn>
      </header>
      <div className="rx-sp-body" role="tabpanel" aria-labelledby={`rx-view-${view}`}>
        {view === "page" ? <PageView deps={deps} settings={settings} /> : view === "tabs" ? deps.tabsView : <PromptsView deps={deps} />}
      </div>
    </div>
  );
}

