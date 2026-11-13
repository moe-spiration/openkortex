// Dev preview of the side panel "Sessions" with a fake chrome.* (storage, tabs, windows) so drag & drop can be tried.
// Open http://localhost:5199/sessions.html (pnpm --filter @kortex/extension preview). State lives in memory only.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./stage.css";
import { SessionsPanel } from "../src/ui/SessionsPanel";
import { ThemeRoot } from "../src/ui/ThemeRoot";

const t = (host: string, title: string) => ({ url: `https://${host}/`, title });
const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const data: Record<string, unknown> = {
  "library.sessions": [
    { id: "a", title: "Recherche · Session 2026-11-03 09:10 (3 Tabs)", saved_at: at(30), tabs: [t("wikipedia.org", "Wikipedia"), t("github.com", "GitHub"), t("news.ycombinator.com", "Hacker News")] },
    { id: "b", title: "Einkauf · Session 2026-11-03 08:00 (2 Tabs)", saved_at: at(120), tabs: [t("amazon.de", "Amazon"), t("ebay.de", "eBay")] },
    { id: "c", title: "Lesen · Session 2026-11-02 21:00 (1 Tab)", saved_at: at(900), tabs: [t("lwn.net", "LWN")] },
  ],
};
const listeners = new Set<() => void>();
const ev = () => ({ addListener: () => undefined, removeListener: () => undefined });
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (k: string) => ({ [k]: data[k] }),
      set: async (o: Record<string, unknown>) => (Object.assign(data, o), listeners.forEach((l) => l())),
      remove: async (k: string) => void delete data[k],
    },
    onChanged: { addListener: (l: () => void) => listeners.add(l), removeListener: (l: () => void) => listeners.delete(l) },
  },
  tabs: {
    query: async () => [
      { id: 1, url: "https://example.com/", title: "Example" },
      { id: 2, url: "https://mdn.dev/", title: "MDN" },
      { id: 3, url: "https://github.com/", title: "GitHub" },
    ],
    create: async () => ({}),
    onCreated: ev(),
    onRemoved: ev(),
    onUpdated: ev(),
  },
  windows: { getCurrent: async () => ({ id: 1 }), create: async () => ({}) },
  runtime: { sendMessage: async () => ({ ok: true, saved: 1, closed: 0 }) },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeRoot theme="dark" className="min-h-screen p-4" style={{ maxWidth: 420 }}>
      <SessionsPanel baseUrl="https://kortex.example.com" />
    </ThemeRoot>
  </StrictMode>,
);
