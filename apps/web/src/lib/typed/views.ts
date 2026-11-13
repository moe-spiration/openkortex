/*
 * Pure helpers of the prompt and session views (note view, Home "Wo Du aufgehört hast"). A prompt's `{{variablen}}`
 * come from its text plus metadata.variables; a session's tabs from metadata.tabs, with the Markdown links of its body
 * as fallback (older captures). Only http(s) links are offered, so "Alle öffnen" never opens script or file URLs.
 */

export interface SessionTab {
  url: string;
  title: string;
}

const VAR = /\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/gu;

/** Variable names of a prompt, in order of first use, without duplicates. */
export function promptVariables(md: string, metadata: Record<string, unknown> = {}): string[] {
  const fromText = [...md.matchAll(VAR)].map((m) => m[1]!);
  const fromMeta = Array.isArray(metadata.variables) ? metadata.variables.filter((v): v is string => typeof v === "string" && !!v.trim()) : [];
  return [...new Set([...fromText, ...fromMeta.map((v) => v.trim())])];
}

const isWebUrl = (u: string): boolean => {
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
};

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** The newest tab sessions (registry type `session`) with at least one web tab, newest first. */
export function latestSessions<T extends { dbType?: string; date: string; time: string; metadata: Record<string, unknown>; contentMd: string }>(
  items: Iterable<T>,
  limit = 3,
): { item: T; tabs: SessionTab[] }[] {
  return [...items]
    .filter((i) => i.dbType === "session")
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    .map((item) => ({ item, tabs: sessionTabs(item.metadata, item.contentMd) }))
    .filter((s) => s.tabs.length > 0)
    .slice(0, limit);
}

/** Tabs of a session item (http(s) only, duplicates dropped). */
export function sessionTabs(metadata: Record<string, unknown>, md = ""): SessionTab[] {
  const raw: { url: string; title?: string }[] = Array.isArray(metadata.tabs)
    ? metadata.tabs.filter((t): t is { url: string; title?: string } => !!t && typeof (t as { url?: unknown }).url === "string")
    : [...md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => ({ url: m[2]!, title: m[1] }));
  const seen = new Set<string>();
  const out: SessionTab[] = [];
  for (const t of raw) {
    const url = t.url.trim();
    if (!isWebUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: t.title?.trim() || hostOf(url) });
  }
  return out;
}
