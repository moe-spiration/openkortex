// Answers the side panel and the popup about this page: the selection, the highlights shown here and (on request)
// a readable text excerpt for "Ask about this page". Runs on every page, also with the highlighter switched off.
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { HIGHLIGHT_CLASS } from "../lib/highlight/locator";
import type { ExtMessage, PageInfo } from "../lib/messages";
import { loadPageHighlights } from "../lib/mock-inbox";
import { chromeStore } from "../lib/settings";

const TEXT_MAX = 24_000;

/** The article if the page has one, else the body; whitespace folded. */
function readableText(): string {
  const root = document.querySelector("article, main, [role='main']") ?? document.body;
  return ((root as HTMLElement | null)?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, TEXT_MAX);
}

function coverImage(): string | null {
  const meta = document.querySelector<HTMLMetaElement>("meta[property='og:image'], meta[name='twitter:image'], meta[property='twitter:image']")?.content;
  if (!meta) return null;
  try {
    const u = new URL(meta, location.href);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export function startPageInfo(ctx: ContentScriptContext, opts: { focusFallback: boolean }) {
  const onMessage = (msg: ExtMessage, _sender: chrome.runtime.MessageSender, reply: (r: unknown) => void) => {
    if (msg?.type === "kortex/page-info") {
      const url = location.href.split("#")[0]!;
      void loadPageHighlights(chromeStore, url).then((list) => {
        const info: PageInfo = {
          url,
          selection: (getSelection()?.toString() ?? "").trim().slice(0, 4000),
          ...(msg.withText ? { text: readableText() } : {}),
          ...(coverImage() ? { image: coverImage()! } : {}),
          highlights: list.map((h) => ({
            id: h.id,
            quote: h.locator.quote.exact,
            ...(h.note ? { note: h.note } : {}),
            ...(h.color ? { color: h.color } : {}),
            saved: !!h.highlightId,
          })),
        };
        reply(info);
      });
      return true;
    }
    // The Ruhe highlighter answers hl-focus itself; without it (switched off, classic look) scroll here.
    if (msg?.type === "kortex/hl-focus" && opts.focusFallback) {
      document.querySelector(`mark.${HIGHLIGHT_CLASS}[data-kortex-hl="${CSS.escape(msg.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  ctx.onInvalidated(() => chrome.runtime.onMessage.removeListener(onMessage));
}
