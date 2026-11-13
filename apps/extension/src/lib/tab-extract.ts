// Reads the page of a tab for a capture: extractor registry first, plain metadata second, the tab object last.
// Shared by the popup (form) and the background worker (autosave), so a closing popup cannot cut it short.
import { EXTRACT_GLOBAL } from "./extract";
import { extractPageMeta, type PageMeta } from "./page-meta";

/** Resolves null when `ms` passes first (the work itself keeps running and is ignored). */
function withBudget<T>(work: Promise<T>, ms?: number): Promise<T | null> {
  if (!ms) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([work, new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)))]).finally(() => clearTimeout(timer));
}

/** Autosave: the plain metadata reader after the full reader gave up. */
const PLAIN_BUDGET_MS = 2500;

/** Null when the tab cannot be captured (internal pages). */
export async function extractTab(
  tab: { id?: number; url?: string; title?: string },
  opts: { /** Autosave: after this the full reader is given up for the plain metadata (no hanging click). */ budgetMs?: number } = {},
): Promise<PageMeta | null> {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) return null;
  const target = { tabId: tab.id };
  try {
    // activeTab grants these one-off injections after the click / Alt+K. The registry
    // (YouTube captions, Amazon photos, podcast artwork, JSON-LD covers) runs in the page.
    const full = (async () => {
      await chrome.scripting.executeScript({ target, files: ["/extract.js"] });
      const [res] = await chrome.scripting.executeScript({
        target,
        func: (name: string) => (globalThis as unknown as Record<string, (() => Promise<unknown>) | undefined>)[name]?.(),
        args: [EXTRACT_GLOBAL],
      });
      return (res?.result as PageMeta | undefined) ?? null;
    })();
    const meta = await withBudget(full, opts.budgetMs);
    if (meta) return meta;
  } catch {
    /* fall back to the plain metadata reader */
  }
  try {
    // A page whose main thread hangs would hang this too: the plain reader gets a short budget of its own.
    const plain = chrome.scripting.executeScript({ target, func: extractPageMeta }).then(([res]) => (res?.result as PageMeta | undefined) ?? null);
    const meta = await withBudget(plain, opts.budgetMs ? PLAIN_BUDGET_MS : undefined);
    if (meta) return meta;
  } catch {
    /* fall back to what the tab object knows */
  }
  const url = new URL(tab.url);
  return {
    url: tab.url,
    title: tab.title || url.hostname,
    description: null,
    image_url: null,
    site_name: null,
    domain: url.hostname.replace(/^www\./, ""),
    reading_minutes: null,
    keywords: [],
  };
}
