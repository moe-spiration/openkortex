// Automatic session names: what the tabs have in common, so a session is recognisable at a glance
// ("Kubernetes · YouTube", "GitHub · kortex +3", "YouTube, Notion +2") instead of a bare timestamp.

type NameTab = { url?: string; title?: string };

/** " - ", " | ", " – ", " · " … between page title and site name. */
const SEP = /\s+[-–—|·•:]\s+/;
const MAX = 60;

const STOP = new Set(
  (
    "the and for with from your this that what when where which how why are was were has have will you our not all new " +
    "about into over more most other some than then them they their there here just only also page home login sign welcome " +
    "search results result inbox dashboard overview untitled settings tab tabs video videos watch " +
    "der die das und mit für von vom zum zur eine einer eines einem ein auf wie was ist sich dem den des aus bei über " +
    "nach oder auch noch nicht sind wird werden kann alle neue neuer neues suche startseite ergebnisse anmelden seite"
  ).split(" "),
);

function host(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** "docs.github.com" -> "github.com" (two-part suffixes like "co.uk" kept whole). */
function siteDomain(h: string): string {
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 3) return h;
  const twoPart = /^(co|com|org|net|ac|gov|edu)$/.test(parts[parts.length - 2]!);
  return parts.slice(twoPart ? -3 : -2).join(".");
}
/** "github.com" -> "github": to tell whether a title's site name belongs to the host. */
const hostLabel = (h: string) => siteDomain(h).split(".")[0] ?? h;

/** Title split into the page part and a trailing site name ("Pods - Kubernetes" -> ["Pods", "Kubernetes"]). */
function splitTitle(title: string): { page: string; site: string } {
  const parts = title.split(SEP).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { page: title.trim(), site: "" };
  const site = parts[parts.length - 1]!;
  const ok = site.length <= 30 && site.split(/\s+/).length <= 4;
  return ok ? { page: parts.slice(0, -1).join(" – "), site } : { page: title.trim(), site: "" };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * A short name for a group of tabs; empty when there is nothing to go on (no http tabs).
 * Order of preference: a topic most tabs share, the one site they all come from, the main sites.
 */
export function autoSessionName(tabs: readonly NameTab[]): string {
  const list = tabs.filter((t) => /^https?:\/\//i.test(t.url ?? ""));
  if (!list.length) return "";

  // site name per host: the most common title suffix of that host, else the host label
  const suffixes = new Map<string, Map<string, number>>();
  const split = list.map((t) => {
    const h = host(t.url);
    const parts = splitTitle(t.title ?? "");
    if (parts.site) {
      const m = suffixes.get(h) ?? new Map<string, number>();
      m.set(parts.site, (m.get(parts.site) ?? 0) + 1);
      suffixes.set(h, m);
    }
    return { h, ...parts };
  });
  // the title's site name only when it is really the site (matches the host), short names as written ("GitHub")
  const siteOf = (h: string) => {
    const domain = siteDomain(h);
    const best = [...(suffixes.get(h)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!best) return domain;
    const norm = best.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const l = hostLabel(h).toLowerCase();
    if (!norm || (!norm.includes(l) && !l.includes(norm))) return domain;
    return best.split(/\s+/).length <= 2 ? best : domain;
  };
  const siteNames = split.map((s) => siteOf(s.h));
  const counts = new Map<string, number>();
  for (const n of siteNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  const sites = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const siteWords = new Set(sites.flatMap((s) => s.toLowerCase().split(/\s+/)));

  if (list.length === 1) return clip(split[0]!.page || sites[0]!, MAX);

  // topic: a word that appears in at least half of the page titles
  const freq = new Map<string, { n: number; shown: string; first: number }>();
  split.forEach((s, i) => {
    const seen = new Set<string>();
    for (const m of s.page.matchAll(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*[\p{L}\p{N}+#]/gu)) {
      const word = m[0];
      const key = word.toLowerCase();
      if (key.length < 3 || /^[\d.,-]+$/.test(key) || STOP.has(key) || siteWords.has(key) || seen.has(key)) continue;
      seen.add(key);
      const f = freq.get(key);
      if (f) f.n++;
      else freq.set(key, { n: 1, shown: word, first: i });
    }
  });
  const need = Math.max(2, Math.ceil(list.length / 2));
  const topics = [...freq.values()].filter((f) => f.n >= need).sort((a, b) => b.n - a.n || a.first - b.first).slice(0, 2);
  const topic = topics.map((f) => f.shown).join(" ");

  if (topic) {
    const where = sites.length <= 2 ? ` · ${sites.join(", ")}` : "";
    return clip(`${topic}${where}`, MAX);
  }
  if (sites.length === 1) {
    const first = split.find((s) => s.page)?.page ?? "";
    return clip(first ? `${sites[0]} · ${clip(first, 28)} +${list.length - 1}` : sites[0]!, MAX);
  }
  return clip(sites.slice(0, 2).join(", ") + (sites.length > 2 ? ` +${sites.length - 2}` : ""), MAX);
}
