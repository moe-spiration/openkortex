// Dev preview only: an in-memory chrome.* so the real extension pages (side panel, popup, options) run in a normal tab.
// Import it before the entrypoint. `?theme=light|dark`, `?empty=1` (no sessions), `?autosave=1` (popup confirmation).
const params = new URLSearchParams(location.search);
const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const fav = (host: string) => `https://${host}/favicon.ico`;
const t = (url: string, title: string, favicon?: string) => ({ url, title, ...(favicon ? { favicon } : {}) });

const SESSIONS = [
  {
    id: "s1",
    item_id: "demo-1",
    title: "Recherche RAG · Session 2026-11-05 09:12 (7 Tabs)",
    saved_at: at(40),
    tabs: [
      t("https://www.anthropic.com/news/contextual-retrieval", "Introducing Contextual Retrieval", fav("www.anthropic.com")),
      t("https://github.com/run-llama/llama_index", "run-llama/llama_index: LlamaIndex is the leading framework", fav("github.com")),
      t("https://arxiv.org/abs/2005.11401", "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"),
      t("https://docs.python.org/3/library/asyncio.html", "asyncio — Asynchronous I/O", fav("docs.python.org")),
      t("https://news.ycombinator.com/item?id=1", "Ask HN: How do you chunk documents?", fav("news.ycombinator.com")),
      t("https://www.youtube.com/watch?v=x", "RAG from scratch", fav("www.youtube.com")),
      t("https://github.com/pgvector/pgvector", "pgvector/pgvector", fav("github.com")),
    ],
  },
  {
    id: "s2",
    title: "Urlaub planen · Session 2026-11-04 20:01 (3 Tabs)",
    saved_at: at(60 * 14),
    tabs: [t("https://www.bahn.de/", "Deutsche Bahn", fav("www.bahn.de")), t("https://www.booking.com/", "Booking.com"), t("https://www.wikipedia.org/", "Wikipedia", fav("www.wikipedia.org"))],
  },
  {
    id: "s3",
    title: "Ein sehr langer Titel einer Session, der nicht in eine Zeile passt und trotzdem sauber bleiben muss",
    saved_at: at(60 * 50),
    tabs: [t("https://developer.chrome.com/docs/extensions/reference/api/sidePanel", "chrome.sidePanel", fav("developer.chrome.com"))],
  },
];

const OPEN_TABS = [
  { id: 1, url: "https://engineering-notes.dev/contextual-retrieval", title: "Contextual Retrieval in der Praxis: Warum Chunks ihren Kontext brauchen", active: true, highlighted: true },
  { id: 2, url: "https://github.com/", title: "GitHub", favIconUrl: "https://github.com/favicon.ico" },
  { id: 3, url: "https://developer.mozilla.org/de/docs/Web/CSS/:has", title: ":has() - CSS | MDN", favIconUrl: "https://developer.mozilla.org/favicon.ico" },
  { id: 4, url: "https://www.figma.com/", title: "Figma", favIconUrl: "https://www.figma.com/favicon.ico" },
  { id: 5, url: "chrome://extensions", title: "Erweiterungen" },
];

const theme = params.get("theme") === "light" ? "light" : "dark";
const data: Record<string, unknown> = {
  "library.sessions": params.get("empty") ? [] : SESSIONS,
  "library.prompts": [
    { id: "p1", title: "Mail an Recruiter", text: "Hallo {{name}}, danke für Ihre Nachricht zu {{rolle}} …", variables: ["name", "rolle"], saved_at: at(90) },
    { id: "p2", title: "Code-Review", text: "Prüfe diesen Diff auf Fehler, nicht auf Stil.", variables: [], saved_at: at(300) },
  ],
  settings: { theme, autosave: !!params.get("autosave") },
  outbox: params.get("queue") ? [{ id: "q1", attempts: 2, nextAttemptAt: Date.now() + 120_000, lastError: "Netzwerk nicht erreichbar", request: { kind: "web_clip", url: "https://x.dev", title: "Offline geclippt", client: { name: "kortex-extension", version: "0" }, captured_at: at(5) } }] : [],
};

const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();
const ev = () => ({ addListener: () => undefined, removeListener: () => undefined, hasListener: () => false });
const PAGE = {
  url: OPEN_TABS[0]!.url,
  title: OPEN_TABS[0]!.title,
  description: "Die meisten RAG-Systeme scheitern nicht am Modell, sondern an den Bruchstücken, die sie ihm zeigen.",
  image_url: "/dce371d5fe87d39ead096ad81beaa92b.webp",
  site_name: "engineering-notes.dev",
  domain: "engineering-notes.dev",
  reading_minutes: 8,
  keywords: ["rag", "retrieval"],
};

const respond = async (msg: { type: string; tabIds?: number[]; request?: { kind: string } }) => {
  switch (msg.type) {
    case "kortex/save-session":
      return { ok: true, saved: msg.tabIds?.length ?? 1, closed: msg.tabIds?.length ?? 1, itemId: "it-1", closedTabs: [{ url: "https://example.com/" }] };
    case "kortex/ingest":
      return { ok: true, delivered: true, response: { ok: true, kind: msg.request?.kind, item_id: "mock-2", type: "article", status: "inbox", folder_path: "30_Clippings", auto_routed: true, duplicate: false, queued: false } };
    case "kortex/autosave":
      return { page: PAGE, result: { ok: true, delivered: true, response: { ok: true, kind: "web_clip", item_id: "mock-3", type: "article", status: "inbox", folder_path: "30_Clippings", auto_routed: true, duplicate: false, queued: false } } };
    case "kortex/status":
      return { ok: false, error: { code: "network", message: "offline" } };
    default:
      return undefined;
  }
};

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (k: string | string[] | null) => {
        if (k === null) return { ...data };
        const keys = Array.isArray(k) ? k : [k];
        return Object.fromEntries(keys.map((x) => [x, data[x]]));
      },
      set: async (o: Record<string, unknown>) => {
        Object.assign(data, o);
        listeners.forEach((l) => l(Object.fromEntries(Object.keys(o).map((x) => [x, { newValue: o[x] }])), "local"));
      },
      remove: async (k: string | string[]) => {
        for (const x of Array.isArray(k) ? k : [k]) delete data[x];
      },
    },
    onChanged: { addListener: (l: () => void) => listeners.add(l), removeListener: (l: () => void) => listeners.delete(l) },
  },
  tabs: {
    query: async () => OPEN_TABS,
    get: async (id: number) => OPEN_TABS.find((x) => x.id === id),
    create: async () => ({}),
    update: async () => ({}),
    remove: async () => undefined,
    onCreated: ev(),
    onRemoved: ev(),
    onUpdated: ev(),
    onMoved: ev(),
    onActivated: ev(),
  },
  windows: {
    getCurrent: async () => ({ id: 1 }),
    getAll: async () => [
      { id: 1, focused: true, tabs: OPEN_TABS.map((t) => ({ ...t, windowId: 1 })) },
      { id: 2, focused: false, tabs: [{ id: 21, windowId: 2, url: "https://linear.app/kortex/issues", title: "Issues · Kortex", favIconUrl: "https://linear.app/favicon.ico" }, { id: 22, windowId: 2, url: "https://vercel.com/dashboard", title: "Dashboard – Vercel" }] },
    ],
    create: async () => ({}),
    update: async () => ({}),
  },
  scripting: { executeScript: async () => [{ result: PAGE }] },
  runtime: { id: "preview", getURL: (p: string) => p, sendMessage: respond, openOptionsPage: async () => undefined, getManifest: () => ({ version: "0.6.2" }), onMessage: ev() },
  permissions: { request: async () => true },
  sidePanel: { open: async () => undefined },
};
