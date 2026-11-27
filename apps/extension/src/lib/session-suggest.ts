// The tab manager's agent suggestion: "3 open tabs fit “Research RAG”". Open tabs whose site already appears in a
// saved session (and that are not in it yet) are proposed for that session; the user accepts, nothing moves alone.
import { sessionKey, type SavedSession } from "./library";

export interface SessionFit<T> {
  sessionKey: string;
  title: string;
  tabs: T[];
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Best fit (most tabs, at least `min`), or null. Generic hosts (search engines, Kortex itself) do not count. */
export function suggestSessionFit<T extends { url?: string; pinned?: boolean }>(
  sessions: readonly SavedSession[],
  open: readonly T[],
  opts: { min?: number; ignoreHosts?: string[]; dismissed?: readonly string[] } = {},
): SessionFit<T> | null {
  const ignore = new Set(["google.com", "bing.com", "duckduckgo.com", "", ...(opts.ignoreHosts ?? [])]);
  const candidates = open.filter((tab) => tab.url && /^https?:/i.test(tab.url) && !tab.pinned && !ignore.has(host(tab.url)));
  let best: SessionFit<T> | null = null;
  for (const s of sessions) {
    const key = sessionKey(s);
    if (opts.dismissed?.includes(key)) continue;
    const hosts = new Set(s.tabs.map((x) => host(x.url)).filter((h) => h && !ignore.has(h)));
    const urls = new Set(s.tabs.map((x) => x.url));
    const fits = candidates.filter((tab) => hosts.has(host(tab.url!)) && !urls.has(tab.url!));
    const unique = fits.filter((tab, i) => fits.findIndex((x) => x.url === tab.url) === i);
    if (unique.length >= (opts.min ?? 2) && unique.length > (best?.tabs.length ?? 0)) best = { sessionKey: key, title: s.title, tabs: unique };
  }
  return best;
}
