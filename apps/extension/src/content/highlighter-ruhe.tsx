// Highlighter in the Ruhe look (2026-11-27): selection bar (colour, Highlight H, Note N, Ask A, ⋯ save as prompt),
// note card, the page's highlight dock and a toast stack with Undo. The bar follows the page's brightness, not the
// Kortex theme. Colour and note are sent with the highlight (`color`, `note_text` of the ingest contract); editing a
// saved highlight replaces it in Kortex (remove + save again), the page keeps its marks.
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { t } from "../i18n";
import type { IngestFailure } from "../lib/api";
import { describeFailure } from "../lib/errors";
import { HIGHLIGHT_CLASS, HIGHLIGHT_CSS_RUHE, UI_ATTR, buildLocator, markRange, removeMarks, resolveLocator, styleMarks } from "../lib/highlight/locator";
import { pageIsDark } from "../lib/highlight/luminance";
import { deleteHighlightViaBackground, sendViaBackground, type AskDraft, type ExtMessage, type HighlightOutcome } from "../lib/messages";
import { addPageHighlight, loadPageHighlights, removePageHighlight, type StoredHighlight } from "../lib/mock-inbox";
import { buildPrompt } from "../lib/prompts";
import { HIGHLIGHT_COLORS, buildHighlight, type HighlightColor } from "../lib/requests";
import { describeHighlightSaved } from "../lib/result";
import { chromeStore, type ExtensionSettings } from "../lib/settings";
import { ToastStack, isTyping, modKey, type RxToast } from "../ui/ruhe/kit";
import { HighlightDock, NoteCard, SelectionBar, type DockItem } from "../ui/ruhe/OnPage";
import { mountReact } from "./mount";
import { createStore, useStore, type Store } from "./store";

interface Bar {
  kind: "new" | "mark";
  left: number;
  top: number;
  /** Saved highlight (kind "mark"). */
  id?: string;
}
interface Card {
  left: number;
  top: number;
  quote: string;
  color: HighlightColor;
  note?: string;
  /** Saved highlight being edited; missing = the pending selection. */
  id?: string;
}
interface UiState {
  dark: boolean;
  color: HighlightColor;
  bar: Bar | null;
  card: Card | null;
  dock: DockItem[];
  toasts: RxToast[];
}

const MIN_CHARS = 3;
const BAR_W = 360;
const CARD_W = 300;
const COLOR_KEY = "kortex.hl.color";

const pageUrl = () => location.href.split("#")[0]!;

function installMarkStyle() {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HIGHLIGHT_CSS_RUHE);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = HIGHLIGHT_CSS_RUHE;
    style.setAttribute(UI_ATTR, "");
    document.head.append(style);
  }
}

function selectionRange(): Range | null {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (range.toString().trim().length < MIN_CHARS) return null;
  const anchor = range.commonAncestorContainer.nodeType === 1 ? (range.commonAncestorContainer as Element) : range.commonAncestorContainer.parentElement;
  if (!anchor || anchor.closest("input, textarea, [contenteditable=''], [contenteditable='true'], [data-kortex-ui]")) return null;
  return range;
}

const anchorOf = (range: Range) => (range.commonAncestorContainer.nodeType === 1 ? (range.commonAncestorContainer as Element) : range.commonAncestorContainer.parentElement);
const isColor = (c: unknown): c is HighlightColor => typeof c === "string" && (HIGHLIGHT_COLORS as readonly string[]).includes(c);

export async function startRuheHighlighter(ctx: ContentScriptContext, settings: ExtensionSettings) {
  installMarkStyle();
  let stored: HighlightColor = "yellow";
  try {
    const v = localStorage.getItem(COLOR_KEY);
    if (isColor(v)) stored = v;
  } catch {
    /* storage blocked on this site */
  }
  const ui = createStore<UiState>({ dark: pageIsDark(document.body), color: stored, bar: null, card: null, dock: [], toasts: [] });
  let pending: Range | null = null;
  /** Local highlights of this page (id -> stored record), for the dock and editing. */
  const records = new Map<string, StoredHighlight & { saved: boolean }>();

  const set = (patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => ui.set((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
  const syncDock = () =>
    set({
      dock: [...records.values()].map((r) => ({ id: r.id, quote: r.locator.quote.exact, note: r.note, color: r.color, saved: r.saved })),
    });

  const toast = (x: Omit<RxToast, "id"> & { id?: string }) => {
    const id = x.id ?? Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts.filter((y) => y.id !== id), { ...x, id }].slice(-3) }));
    return id;
  };
  const dismiss = (id: string) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));

  const pickColor = (c: HighlightColor) => {
    set({ color: c });
    try {
      localStorage.setItem(COLOR_KEY, c);
    } catch {
      /* fine */
    }
  };

  await mountReact(ctx, {
    name: "kortex-highlighter",
    theme: settings.theme,
    look: "ruhe",
    position: "overlay",
    node: (
      <RuheHighlighterView
        ui={ui}
        dismiss={dismiss}
        actions={{
          color: (c) => {
            pickColor(c);
            const bar = ui.get().bar;
            if (bar?.kind === "new") void saveSelection({ color: c });
            else if (bar?.id) void edit(bar.id, { color: c });
          },
          highlight: () => void saveSelection({}),
          note: () => openCard(),
          ask: () => void ask(),
          savePrompt: () => void savePrompt(),
          remove: () => {
            const id = ui.get().bar?.id;
            if (id) void removeHighlight(id);
          },
          saveCard: (note, color) => void saveCard(note, color),
          cancelCard: () => set({ card: null }),
          deleteCard: () => {
            const card = ui.get().card;
            set({ card: null });
            if (card?.id) void removeHighlight(card.id);
          },
          jump: (id) => focusMark(id),
          openPanel: () => void chrome.runtime.sendMessage({ type: "kortex/open-sidepanel" } satisfies ExtMessage).catch(() => undefined),
        }}
      />
    ),
  });

  function hideBar() {
    pending = null;
    if (ui.get().bar) set({ bar: null });
  }

  function place(rect: DOMRect, width: number, height = 44) {
    const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    const above = rect.top - height - 8;
    return { left, top: above < 8 ? rect.bottom + 10 : above };
  }

  function showBar() {
    if (ui.get().card) return;
    const range = selectionRange();
    if (!range) return hideBar();
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return hideBar();
    pending = range.cloneRange();
    set({ dark: pageIsDark(anchorOf(range)), bar: { kind: "new", ...place(rect, BAR_W) } });
  }

  /** Optimistic: mark at once, send, keep the server id; a final refusal rolls the marks back. */
  async function saveSelection(opts: { color?: HighlightColor; note?: string }): Promise<HighlightOutcome> {
    const range = pending ?? selectionRange();
    hideBar();
    if (!range) {
      toast({ tone: "error", text: t("No selection to save") });
      return { ok: false, message: t("No selection to save") };
    }
    const locator = buildLocator(range, document.body);
    if (!locator) {
      toast({ tone: "error", text: t("This selection cannot be saved") });
      return { ok: false, message: t("This selection cannot be saved") };
    }
    const color = opts.color ?? ui.get().color;
    const dark = pageIsDark(anchorOf(range));
    const id = crypto.randomUUID();
    markRange(range, id);
    styleMarks(document.body, id, color, dark);
    getSelection()?.removeAllRanges();
    const record = { id, locator, savedAt: new Date().toISOString(), color, ...(opts.note?.trim() ? { note: opts.note.trim() } : {}), saved: false };
    records.set(id, record);
    syncDock();
    const busy = toast({ tone: "busy", text: t("Saving …") });

    const res = await sendViaBackground(buildHighlight({ url: pageUrl(), title: document.title }, locator.quote.exact, locator, new Date(), { color, note: opts.note }));
    dismiss(busy);
    if (!res.ok) {
      removeMarks(document.body, id);
      records.delete(id);
      syncDock();
      const message = describeFailure({ ok: false, error: res.error as IngestFailure["error"] }).message;
      toast({ tone: "error", text: t("Highlight not saved"), detail: message });
      return { ok: false, message };
    }
    const highlightId = res.delivered ? (res.response as { highlight_id?: unknown }).highlight_id : undefined;
    const { saved: _saved, ...plain } = record;
    void _saved;
    const keep: StoredHighlight = { ...plain, ...(typeof highlightId === "string" && highlightId ? { highlightId } : {}) };
    await addPageHighlight(chromeStore, pageUrl(), keep);
    records.set(id, { ...keep, saved: res.delivered });
    syncDock();
    const text = describeHighlightSaved(res);
    const folder = res.delivered ? res.response.folder_path : undefined;
    toast({
      tone: res.delivered ? "ok" : "warn",
      text: res.delivered ? t("Highlight saved") : t("Highlight kept, will be sent"),
      detail: folder?.split("/").pop(),
      action: { label: t("Undo"), kbd: "⌘Z", onClick: () => void removeHighlight(id, true) },
    });
    return { ok: true, text };
  }

  function openCard(id?: string) {
    const rec = id ? records.get(id) : undefined;
    const range = rec ? null : (pending ?? selectionRange());
    const quote = rec ? rec.locator.quote.exact : (range?.toString().trim() ?? "");
    if (!quote) return;
    const el = rec ? document.querySelector(`mark.${HIGHLIGHT_CLASS}[data-kortex-hl="${CSS.escape(rec.id)}"]`) : null;
    const rect = el?.getBoundingClientRect() ?? range?.getBoundingClientRect();
    if (range) pending = range.cloneRange();
    const pos = rect ? place(rect, CARD_W, 170) : { left: innerWidth - CARD_W - 16, top: 80 };
    set({ bar: null, card: { ...pos, quote, color: isColor(rec?.color) ? rec!.color : ui.get().color, note: rec?.note, id: rec?.id } });
  }

  async function saveCard(note: string, color: HighlightColor) {
    const card = ui.get().card;
    set({ card: null });
    pickColor(color);
    if (card?.id) await edit(card.id, { color, note });
    else await saveSelection({ color, note });
  }

  /** Colour or note of a saved highlight: page first, then Kortex (remove the old one, save the new one). */
  async function edit(id: string, change: { color?: HighlightColor; note?: string }) {
    const rec = records.get(id);
    if (!rec) return;
    set({ bar: null });
    const next = { ...rec, ...(change.color ? { color: change.color } : {}), ...(change.note !== undefined ? { note: change.note.trim() || undefined } : {}) };
    const first = document.querySelector(`mark.${HIGHLIGHT_CLASS}[data-kortex-hl="${CSS.escape(id)}"]`);
    styleMarks(document.body, id, next.color, pageIsDark(first));
    records.set(id, { ...next, saved: false });
    syncDock();
    if (rec.highlightId) await deleteHighlightViaBackground(rec.highlightId);
    const res = await sendViaBackground(
      buildHighlight({ url: pageUrl(), title: document.title }, rec.locator.quote.exact, rec.locator, new Date(), { color: isColor(next.color) ? next.color : undefined, note: next.note }),
    );
    if (!res.ok) {
      toast({ tone: "error", text: t("Change not saved"), detail: describeFailure({ ok: false, error: res.error as IngestFailure["error"] }).message });
      return;
    }
    const highlightId = res.delivered ? (res.response as { highlight_id?: unknown }).highlight_id : undefined;
    const { saved: _s, highlightId: _old, ...plain } = next;
    void _s;
    void _old;
    const keep: StoredHighlight = { ...plain, ...(typeof highlightId === "string" && highlightId ? { highlightId } : {}) };
    await addPageHighlight(chromeStore, pageUrl(), keep);
    records.set(id, { ...keep, saved: res.delivered });
    syncDock();
    toast({ tone: "ok", text: change.note !== undefined ? t("Note saved") : t("Colour changed") });
  }

  async function removeHighlight(id: string, quiet = false) {
    set({ bar: null });
    removeMarks(document.body, id);
    records.delete(id);
    syncDock();
    const storedHl = await removePageHighlight(chromeStore, pageUrl(), id);
    if (!storedHl?.highlightId) {
      if (!quiet) toast({ tone: "ok", text: t("Highlight removed") });
      return;
    }
    const res = await deleteHighlightViaBackground(storedHl.highlightId);
    if (res.ok) toast({ tone: "ok", text: quiet ? t("Undone, removed in Kortex too") : t("Highlight removed, in Kortex too") });
    else toast({ tone: "error", text: t("Removed on the page, not in Kortex"), detail: res.error.message });
  }

  async function ask() {
    const bar = ui.get().bar;
    const rec = bar?.id ? records.get(bar.id) : undefined;
    const quote = rec ? rec.locator.quote.exact : ((pending ?? selectionRange())?.toString().trim() ?? "");
    hideBar();
    set({ bar: null });
    const draft: AskDraft = { url: pageUrl(), title: document.title, quote: quote.slice(0, 2000), at: Date.now() };
    const how = (await chrome.runtime.sendMessage({ type: "kortex/open-sidepanel", ask: draft } satisfies ExtMessage).catch(() => "none")) as string;
    if (how === "none") toast({ tone: "warn", text: t("Open the side panel to ask"), detail: t("The question waits there ({key}).", { key: "Alt+S" }) });
  }

  async function savePrompt() {
    const text = (pending ?? selectionRange())?.toString().trim();
    hideBar();
    if (!text) return;
    const res = await sendViaBackground(buildPrompt(text));
    if (res.ok) toast({ tone: "ok", text: t("Saved as prompt") });
    else toast({ tone: "error", text: t("Prompt not saved"), detail: describeFailure({ ok: false, error: res.error as IngestFailure["error"] }).message });
  }

  function focusMark(id: string) {
    const marks = [...document.querySelectorAll<HTMLElement>(`mark.${HIGHLIGHT_CLASS}[data-kortex-hl="${CSS.escape(id)}"]`)];
    if (!marks.length) return;
    marks[0]!.scrollIntoView({ behavior: "smooth", block: "center" });
    for (const m of marks) m.dataset.kxFocus = "";
    setTimeout(() => marks.forEach((m) => delete m.dataset.kxFocus), 1600);
  }

  // Click on a saved highlight: the bar for it (recolour, note, ask, remove).
  const onClick = (e: MouseEvent) => {
    if (e.composedPath().some((n) => n instanceof Element && n.hasAttribute(UI_ATTR))) return;
    const mark = (e.target as Element | null)?.closest?.(`mark.${HIGHLIGHT_CLASS}`) as HTMLElement | null;
    const id = mark?.getAttribute("data-kortex-hl");
    if (!mark || !id || !getSelection()?.isCollapsed) {
      if (ui.get().bar?.kind === "mark") set({ bar: null });
      return;
    }
    const rec = records.get(id);
    if (isColor(rec?.color)) set({ color: rec!.color });
    set({ dark: pageIsDark(mark), bar: { kind: "mark", id, ...place(mark.getBoundingClientRect(), BAR_W - 70) } });
  };

  async function restore() {
    for (const h of await loadPageHighlights(chromeStore, pageUrl())) {
      if (!records.has(h.id)) records.set(h.id, { ...h, saved: !!h.highlightId });
      if (document.querySelector(`mark.${HIGHLIGHT_CLASS}[data-kortex-hl="${CSS.escape(h.id)}"]`)) continue;
      const range = resolveLocator(h.locator, document.body);
      if (!range) continue;
      markRange(range, h.id);
      styleMarks(document.body, h.id, h.color, pageIsDark(anchorOf(range)));
    }
    syncDock();
  }

  const onPointerUp = (e: Event) => {
    if (e.composedPath().some((n) => n instanceof Element && n.hasAttribute(UI_ATTR))) return;
    setTimeout(showBar, 0);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // the real target inside our shadow root (the note field) or the page's own fields
    if (isTyping({ target: e.composedPath()[0] ?? e.target })) return;
    const s = ui.get();
    if (e.key === "Escape") {
      if (s.bar || s.card) set({ bar: null, card: null });
      return;
    }
    // ⌘Z right after a highlight: undo it (only while its toast is up, so the page's own undo stays intact otherwise).
    if (modKey(e) && !e.shiftKey && e.key.toLowerCase() === "z") {
      const undo = [...s.toasts].reverse().find((x) => x.action);
      if (undo?.action) {
        e.preventDefault();
        undo.action.onClick();
        dismiss(undo.id);
      }
      return;
    }
    if (!s.bar || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "h" && s.bar.kind === "new") {
      e.preventDefault();
      void saveSelection({});
    } else if (k === "n") {
      e.preventDefault();
      openCard(s.bar.id);
    } else if (k === "a") {
      e.preventDefault();
      void ask();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.shiftKey && !isTyping({ target: e.composedPath()[0] ?? e.target })) setTimeout(showBar, 0);
  };
  const onSelectionChange = () => {
    if (ui.get().bar?.kind === "new" && !selectionRange()) hideBar();
  };
  const onScroll = () => {
    const s = ui.get();
    if (s.bar?.kind === "mark") set({ bar: null });
    if (pending && s.bar?.kind === "new") showBar();
  };

  ctx.addEventListener(document, "mouseup", onPointerUp);
  ctx.addEventListener(document, "click", onClick);
  ctx.addEventListener(document, "keydown", onKeyDown, { capture: true });
  ctx.addEventListener(document, "keyup", onKeyUp);
  ctx.addEventListener(document, "selectionchange", onSelectionChange);
  ctx.addEventListener(window, "scroll", onScroll, { passive: true, capture: true });

  const onMessage = (msg: ExtMessage, _sender: chrome.runtime.MessageSender, reply: (r: unknown) => void) => {
    if (msg?.type === "kortex/highlight-selection") {
      void saveSelection({ color: msg.color, note: msg.note }).then(reply);
      return true;
    }
    if (msg?.type === "kortex/hl-focus") focusMark(msg.id);
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  ctx.onInvalidated(() => chrome.runtime.onMessage.removeListener(onMessage));

  void restore();
  ctx.setTimeout(() => void restore(), 2000);
  ctx.setTimeout(() => void restore(), 6000);
}

interface ViewActions {
  color: (c: HighlightColor) => void;
  highlight: () => void;
  note: () => void;
  ask: () => void;
  savePrompt: () => void;
  remove: () => void;
  saveCard: (note: string, color: HighlightColor) => void;
  cancelCard: () => void;
  deleteCard: () => void;
  jump: (id: string) => void;
  openPanel: () => void;
}

function RuheHighlighterView({ ui, actions, dismiss }: { ui: Store<UiState>; actions: ViewActions; dismiss: (id: string) => void }) {
  const s = useStore(ui);
  return (
    <div className="rx" data-theme={s.dark ? "dark" : "light"}>
      {s.bar && (
        <SelectionBar
          kind={s.bar.kind}
          color={s.color}
          onColor={actions.color}
          onHighlight={actions.highlight}
          onNote={actions.note}
          onAsk={actions.ask}
          onSavePrompt={s.bar.kind === "new" ? actions.savePrompt : undefined}
          onRemove={s.bar.kind === "mark" ? actions.remove : undefined}
          style={{ left: s.bar.left, top: s.bar.top }}
        />
      )}
      {s.card && (
        <NoteCard
          quote={s.card.quote}
          color={s.card.color}
          note={s.card.note}
          saved={!!s.card.id}
          onSave={actions.saveCard}
          onCancel={actions.cancelCard}
          onDelete={actions.deleteCard}
          style={{ left: s.card.left, top: s.card.top, width: 300 }}
        />
      )}
      <HighlightDock items={s.dock} onJump={actions.jump} onOpenPanel={actions.openPanel} />
      <ToastStack toasts={s.toasts} onDismiss={dismiss} style={{ bottom: s.dock.length ? 58 : 16 }} />
    </div>
  );
}
