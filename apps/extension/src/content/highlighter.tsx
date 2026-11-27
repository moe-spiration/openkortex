import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { t } from "../i18n";
import type { IngestFailure } from "../lib/api";
import { describeFailure } from "../lib/errors";
import type { ExtMessage } from "../lib/messages";
import { deleteHighlightViaBackground, sendViaBackground } from "../lib/messages";
import { addPageHighlight, loadPageHighlights, removePageHighlight } from "../lib/mock-inbox";
import { buildHighlight } from "../lib/requests";
import { chromeStore, type ExtensionSettings } from "../lib/settings";
import { describeHighlightSaved } from "../lib/result";
import { HIGHLIGHT_CLASS, HIGHLIGHT_CSS, UI_ATTR, buildLocator, markRange, removeMarks, resolveLocator } from "../lib/highlight/locator";
import { MarkToolbar, SelectionToolbar } from "../ui/SelectionToolbar";
import { Toast, type ToastMessage } from "../ui/Toast";
import { createStore, useStore } from "./store";
import { mountReact } from "./mount";

interface UiState {
  toolbar: { left: number; top: number } | null;
  /** Click on a saved highlight: the small "Entfernen" menu. */
  mark: { id: string; left: number; top: number } | null;
  toast: ToastMessage | null;
}

const MIN_CHARS = 3;
const TOOLBAR_W = 280;

/** Marks live in the page DOM, so their style goes into the page (adoptedStyleSheets: immune to page CSP). */
function installMarkStyle() {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HIGHLIGHT_CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = HIGHLIGHT_CSS;
    style.setAttribute(UI_ATTR, "");
    document.head.append(style);
  }
}

const pageUrl = () => location.href.split("#")[0]!;

function selectionRange(): Range | null {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const text = range.toString().trim();
  if (text.length < MIN_CHARS) return null;
  const anchor = range.commonAncestorContainer.nodeType === 1 ? (range.commonAncestorContainer as Element) : range.commonAncestorContainer.parentElement;
  if (!anchor || anchor.closest("input, textarea, [contenteditable=''], [contenteditable='true'], [data-kortex-ui]")) return null;
  return range;
}

export async function startHighlighter(ctx: ContentScriptContext, settings: ExtensionSettings) {
  installMarkStyle();
  const ui = createStore<UiState>({ toolbar: null, mark: null, toast: null });
  let pending: Range | null = null;

  await mountReact(ctx, {
    name: "kortex-highlighter",
    theme: settings.theme,
    look: settings.look,
    position: "overlay",
    node: <HighlighterView ui={ui} onHighlight={() => void saveSelection()} onRemove={(id) => void removeHighlight(id)} />,
  });

  function hideToolbar() {
    pending = null;
    if (ui.get().toolbar) ui.set((s) => ({ ...s, toolbar: null }));
  }

  function showToolbar() {
    const range = selectionRange();
    if (!range) return hideToolbar();
    pending = range.cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return hideToolbar();
    const left = Math.max(8, Math.min(rect.left, innerWidth - TOOLBAR_W - 8));
    const above = rect.top - 52;
    ui.set((s) => ({ ...s, toolbar: { left, top: above < 8 ? rect.bottom + 10 : above } }));
  }

  const toast = (text: string, tone: ToastMessage["tone"] = "success") => ui.set((s) => ({ ...s, toast: { text, tone } }));

  async function saveSelection() {
    const range = pending ?? selectionRange();
    hideToolbar();
    if (!range) return toast(t("No selection to save"), "error");
    const locator = buildLocator(range, document.body);
    if (!locator) return toast(t("This selection cannot be saved"), "error");

    // optimistic: mark right away, roll back if the request is refused for good
    const id = crypto.randomUUID();
    markRange(range, id);
    getSelection()?.removeAllRanges();

    const res = await sendViaBackground(buildHighlight({ url: pageUrl(), title: document.title }, locator.quote.exact, locator));
    if (!res.ok) {
      removeMarks(document.body, id);
      return toast(describeFailure({ ok: false, error: res.error as IngestFailure["error"] }).message, "error");
    }
    const highlightId = res.delivered ? (res.response as { highlight_id?: unknown }).highlight_id : undefined;
    await addPageHighlight(chromeStore, pageUrl(), {
      id,
      locator,
      savedAt: new Date().toISOString(),
      ...(typeof highlightId === "string" && highlightId ? { highlightId } : {}),
    });
    toast([describeHighlightSaved(res), ...(res.notices ?? [])].join(". "));
  }

  /** "Highlight entfernen": unmark the page at once, forget it here, then remove it in Kortex. */
  async function removeHighlight(id: string) {
    ui.set((s) => ({ ...s, mark: null }));
    removeMarks(document.body, id);
    const stored = await removePageHighlight(chromeStore, pageUrl(), id);
    if (!stored?.highlightId) return toast(t("Highlight removed"));
    const res = await deleteHighlightViaBackground(stored.highlightId);
    if (res.ok) return toast(t("Highlight removed, in Kortex too"));
    toast(t("Removed on the page, not in Kortex: {message}", { message: res.error.message }), "error");
  }

  // A click on a saved highlight opens the small "Entfernen" menu next to it.
  const onClick = (e: MouseEvent) => {
    if (e.composedPath().some((n) => n instanceof Element && n.hasAttribute(UI_ATTR))) return;
    const mark = (e.target as Element | null)?.closest?.(`mark.${HIGHLIGHT_CLASS}`) as HTMLElement | null;
    const id = mark?.getAttribute("data-kortex-hl");
    if (!mark || !id || !getSelection()?.isCollapsed) {
      if (ui.get().mark) ui.set((s) => ({ ...s, mark: null }));
      return;
    }
    const rect = mark.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, innerWidth - 220));
    const above = rect.top - 48;
    ui.set((s) => ({ ...s, toolbar: null, mark: { id, left, top: above < 8 ? rect.bottom + 8 : above } }));
  };

  async function restore() {
    for (const h of await loadPageHighlights(chromeStore, pageUrl())) {
      if (document.querySelector(`mark.kortex-hl[data-kortex-hl="${CSS.escape(h.id)}"]`)) continue;
      const range = resolveLocator(h.locator, document.body);
      if (range) markRange(range, h.id);
    }
  }

  const onPointerUp = (e: Event) => {
    if (e.composedPath().some((n) => n instanceof Element && n.hasAttribute(UI_ATTR))) return;
    // wait a tick: the selection is final after mouseup
    setTimeout(showToolbar, 0);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      hideToolbar();
      if (ui.get().mark) ui.set((s) => ({ ...s, mark: null }));
    }
    else if (e.shiftKey || e.key === "a") setTimeout(showToolbar, 0);
  };
  const onSelectionChange = () => {
    if (!selectionRange()) hideToolbar();
  };
  const onScroll = () => {
    if (ui.get().mark) ui.set((s) => ({ ...s, mark: null }));
    if (pending) showToolbar();
  };

  ctx.addEventListener(document, "mouseup", onPointerUp);
  ctx.addEventListener(document, "click", onClick);
  ctx.addEventListener(document, "keyup", onKeyUp);
  ctx.addEventListener(document, "selectionchange", onSelectionChange);
  ctx.addEventListener(window, "scroll", onScroll, { passive: true, capture: true });

  const onMessage = (msg: ExtMessage) => {
    if (msg?.type === "kortex/highlight-selection") void saveSelection();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  ctx.onInvalidated(() => chrome.runtime.onMessage.removeListener(onMessage));

  // pages render late (SPAs): try again a couple of times
  void restore();
  ctx.setTimeout(() => void restore(), 2000);
  ctx.setTimeout(() => void restore(), 6000);
}

function HighlighterView({
  ui,
  onHighlight,
  onRemove,
}: {
  ui: ReturnType<typeof createStore<UiState>>;
  onHighlight: () => void;
  onRemove: (id: string) => void;
}) {
  const state = useStore(ui);
  return (
    <>
      {state.toolbar && (
        <SelectionToolbar
          onHighlight={onHighlight}
          style={{ position: "fixed", left: state.toolbar.left, top: state.toolbar.top }}
        />
      )}
      {state.mark && (
        <MarkToolbar
          onRemove={() => onRemove(state.mark!.id)}
          style={{ position: "fixed", left: state.mark.left, top: state.mark.top }}
        />
      )}
      {state.toast && (
        <div style={{ position: "fixed", bottom: 48, left: "50%", marginLeft: -180 }}>
          <Toast message={state.toast} onDone={() => ui.set((s) => ({ ...s, toast: null }))} />
        </div>
      )}
    </>
  );
}
