// @vitest-environment jsdom
// Side panel "Sessions": display helpers, local rename/undo, and the panel itself against a fake chrome.*.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient, type SearchHit } from "../src/lib/api";
import {
  deleteSessionEntry,
  loadSessionLibrary,
  mergePrompts,
  mergeSessions,
  parseLinkList,
  promptFromHit,
  readSessions,
  rememberSession,
  removeSession,
  renameSession,
  renameSessionEntry,
  restoreSession,
  savedAtFromTitle,
  sessionFromHit,
  syncLibrary,
  undoSessionDelete,
  type SavedSession,
} from "../src/lib/library";
import {
  cardTitle,
  displayTitle,
  faviconSrc,
  faviconStrip,
  initialSelection,
  kortexSessionUrl,
  sessionDateLabel,
  sessionMarkdown,
  tabCount,
  tabDomain,
} from "../src/lib/session-view";
import { buildSession, markdownLinkList } from "../src/lib/sessions";
import { DEFAULT_SETTINGS, memoryStore } from "../src/lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = new Date(2026, 9, 31, 14, 5);
const session = (over: Partial<SavedSession> = {}): SavedSession => ({
  id: "s1",
  title: "Recherche · Session 2026-10-31 14:05 (3 Tabs)",
  saved_at: now.toISOString(),
  tabs: [
    { url: "https://www.a.dev/x", title: "A [wip]", favicon: "https://a.dev/favicon.ico" },
    { url: "https://a.dev/y", title: "A2" },
    { url: "https://b.dev/", favicon: "chrome://theme/IDR_EXTENSIONS_FAVICON" },
  ],
  ...over,
});

describe("session view helpers", () => {
  it("shows domains, safe favicons and one favicon per domain", () => {
    expect(tabDomain("https://www.a.dev/x")).toBe("a.dev");
    expect(tabDomain("kaputt")).toBe("");
    expect(faviconSrc("https://a.dev/f.ico")).toBe("https://a.dev/f.ico");
    expect(faviconSrc("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(faviconSrc("chrome://theme/x")).toBeNull();
    expect(faviconSrc(undefined)).toBeNull();
    expect(faviconStrip(session().tabs).map((t) => t.url)).toEqual(["https://www.a.dev/x", "https://b.dev/"]);
    expect(faviconStrip(session().tabs, 1)).toHaveLength(1);
  });

  it("labels title, count and date for the card", () => {
    expect(displayTitle(session().title)).toBe("Recherche · Session 2026-10-31 14:05");
    expect(displayTitle("Mein Name")).toBe("Mein Name");
    expect(tabCount(1)).toBe("1 Tab");
    expect(tabCount(12)).toBe("12 Tabs");
    expect(sessionDateLabel(new Date(2026, 9, 31, 9, 7).toISOString(), now)).toBe("Heute, 09:07");
    expect(sessionDateLabel(new Date(2026, 9, 30, 23, 59).toISOString(), now)).toBe("Gestern, 23:59");
    expect(sessionDateLabel(new Date(2026, 8, 2, 8, 0).toISOString(), now)).toBe("02.09.26, 08:00");
    expect(sessionDateLabel("nope", now)).toBe("");
  });

  it("titles a card by its name, or by its domains when it has none", () => {
    expect(cardTitle(session())).toBe("Recherche");
    expect(cardTitle(session({ title: "Session 2026-10-31 14:05 (3 Tabs)" }))).toBe("a.dev, b.dev");
    expect(cardTitle(session({ title: "Mein Name" }))).toBe("Mein Name");
    expect(cardTitle(session({ title: "Session 2026-10-31 14:05 (0 Tabs)", tabs: [] }))).toBe("Session 2026-10-31 14:05");
  });

  it("copies the same Markdown link list the session note contains", () => {
    const md = sessionMarkdown(session());
    expect(md).toBe(String.raw`- [A \[wip\]](<https://www.a.dev/x>)` + "\n- [A2](<https://a.dev/y>)\n- [b.dev](<https://b.dev/>)");
    const note = buildSession(session().tabs, now);
    expect(note.content_md).toBe(`# ${note.title}\n\n${md}\n`);
    expect(markdownLinkList([{ url: "chrome://settings" }])).toBe("");
  });

  it("links to the Kortex note, or to the sessions folder while the item id is unknown", () => {
    expect(kortexSessionUrl("https://kortex.example.com/", { item_id: "abc-1" })).toBe("https://kortex.example.com/notes/abc-1");
    expect(kortexSessionUrl("http://localhost:3000", {})).toBe("http://localhost:3000/vault/30_Clippings/Sessions");
    expect(kortexSessionUrl("", {})).toBeNull();
  });

  it("preselects the highlighted tabs only when several are marked", () => {
    const tabs = [{ id: 1, highlighted: true }, { id: 2 }, { id: 3, highlighted: true }, { highlighted: true }];
    expect([...initialSelection(tabs)]).toEqual([1, 3]);
    expect([...initialSelection([{ id: 1, highlighted: true }, { id: 2 }])]).toEqual([1, 2]);
  });
});

describe("local session library", () => {
  it("renames locally (trimmed, empty ignored) and restores a deleted entry at its place", async () => {
    const store = memoryStore();
    for (const id of ["c", "b", "a"]) await rememberSession(store, [{ url: `https://${id}.dev/` }], { id, title: id, saved_at: now.toISOString() });
    await renameSession(store, "b", "  Neuer   Name ");
    await renameSession(store, "a", "   ");
    expect((await readSessions(store)).map((s) => s.title)).toEqual(["a", "Neuer Name", "c"]);
    const [, b] = await readSessions(store);
    await removeSession(store, "b");
    await restoreSession(store, b!, 1);
    await restoreSession(store, b!, 1); // undo twice never duplicates
    expect((await readSessions(store)).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

/* ---------- server library (GET /api/search) ---------- */

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  item_id: "srv-1",
  title: "Session 2026-10-30 08:15 (2 Tabs)",
  type: "session",
  folder_path: "30_Clippings/Sessions",
  source_url: null,
  tags: [],
  content_md: "# Session 2026-10-30 08:15 (2 Tabs)\n\n- [A \\[wip\\]](<https://a.dev/x>)\n- [B](https://b.dev/)\n",
  ...over,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const live = async () => ({ ...DEFAULT_SETTINGS, mockMode: false, baseUrl: "https://kortex.example.com", token: "kx_test" });

describe("server library", () => {
  it("reads tabs and date back from a session note", () => {
    const tabs = [{ url: "https://a.dev/x", title: "A [wip]" }, { url: "https://b.dev/" }];
    expect(parseLinkList(markdownLinkList(tabs))).toEqual([{ url: "https://a.dev/x", title: "A [wip]" }, { url: "https://b.dev/", title: "b.dev" }]);
    expect(sessionFromHit(hit())).toMatchObject({ id: "kortex:srv-1", item_id: "srv-1", saved_at: "2026-10-30T08:15:00.000Z", tabs: [{ url: "https://a.dev/x", title: "A [wip]" }, { url: "https://b.dev/", title: "B" }] });
    expect(savedAtFromTitle("Lesezeichen")).toBe("");
    expect(promptFromHit(hit({ type: "prompt", title: "Mail", content_md: "Hallo {{name}}" }))).toMatchObject({ text: "Hallo {{name}}", variables: ["name"] });
  });

  it("lists items through /api/search with the type filter and the token", async () => {
    const fetchImpl = vi.fn<(u: URL | RequestInfo, i?: RequestInit) => Promise<Response>>(async () => json(200, { ok: true, query: "", mode: "recent", results: [hit(), hit({ item_id: "x", type: "note" }), { broken: true }] }));
    const api = createApiClient({ getSettings: live, fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await api.listItems("session");
    expect(res).toMatchObject({ ok: true, data: [{ item_id: "srv-1" }] });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://kortex.example.com/api/search?type=session&limit=50&content=1&semantic=0");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer kx_test");

    const denied = createApiClient({ getSettings: live, fetchImpl: (async () => json(403, { ok: false, error: { code: "forbidden", message: "scope" } })) as typeof fetch });
    expect(await denied.listItems("prompt")).toMatchObject({ ok: false, error: { code: "unauthorized", message: expect.stringContaining("Suche") } });
    const mock = createApiClient({ getSettings: async () => DEFAULT_SETTINGS, fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(await mock.listItems("prompt")).toMatchObject({ ok: false, error: { code: "setup_required" } });
  });

  it("merges server and local entries without duplicates; local-only entries stay", () => {
    const local: SavedSession[] = [
      session({ id: "l1", title: "Lokal", item_id: "srv-1", saved_at: "2026-10-29T10:00:00.000Z" }),
      session({ id: "l2", title: "Session 2026-10-28 09:00 (1 Tabs)", saved_at: "2026-10-28T09:00:00.000Z" }), // offline saved, now on the server
      session({ id: "l3", title: "Nur hier", saved_at: "2026-10-31T10:00:00.000Z" }),
    ];
    const remote = [
      sessionFromHit(hit()),
      sessionFromHit(hit({ item_id: "srv-2", title: "Session 2026-10-28 09:00 (1 Tabs)" })),
      sessionFromHit(hit({ item_id: "srv-3", title: "Aus dem Web" })), // no date
      sessionFromHit(hit({ item_id: "srv-4", title: "Session 2026-10-30 12:00 (1 Tabs)" })),
      sessionFromHit(hit({ item_id: "srv-5", title: "Ausgeblendet" })),
    ];
    const merged = mergeSessions(local, remote, ["srv-5"]);
    expect(merged.map((s) => [s.id, s.origin])).toEqual([
      ["l3", "local"],
      ["kortex:srv-4", "server"],
      ["l1", "local"],
      ["l2", "local"],
      ["kortex:srv-3", "server"],
    ]);
    expect(merged.find((s) => s.id === "l2")!.item_id).toBe("srv-2");
    const prompts = mergePrompts(
      [{ id: "p1", title: "Mail", text: "Hallo {{name}}", variables: ["name"], saved_at: now.toISOString() }],
      [promptFromHit(hit({ item_id: "pp", type: "prompt", title: "Mail", content_md: "Hallo {{name}}\n" })), promptFromHit(hit({ item_id: "pq", type: "prompt", title: "MCP", content_md: "x" }))],
    );
    expect(prompts.map((p) => [p.id, p.item_id])).toEqual([["p1", "pp"], ["kortex:pq", "pq"]]);
  });

  it("caches the server list, keeps it offline and drops it without a connection", async () => {
    const store = memoryStore();
    await rememberSession(store, [{ url: "https://l.dev/" }], { id: "l", title: "Lokal", saved_at: now.toISOString() });
    const ok = { listItems: async () => ({ ok: true as const, data: [hit()] }) };
    expect(await syncLibrary(store, ok, "session")).toEqual({ state: "synced", count: 1 });
    expect((await loadSessionLibrary(store)).map((s) => s.id)).toEqual(["l", "kortex:srv-1"]);

    const offline = { listItems: async () => ({ ok: false as const, error: { code: "network" as const, message: "weg" } }) };
    expect(await syncLibrary(store, offline, "session")).toEqual({ state: "offline" });
    expect(await loadSessionLibrary(store)).toHaveLength(2);
    const thrown = { listItems: async () => Promise.reject(new Error("boom")) };
    expect(await syncLibrary(store, thrown, "session")).toEqual({ state: "offline" });

    const denied = { listItems: async () => ({ ok: false as const, error: { code: "unauthorized" as const, message: "kein Scope" } }) };
    expect(await syncLibrary(store, denied, "session")).toEqual({ state: "error", message: "kein Scope" });
    const none = { listItems: async () => ({ ok: false as const, error: { code: "setup_required" as const, message: "" } }) };
    expect(await syncLibrary(store, none, "session")).toEqual({ state: "local" });
    expect((await loadSessionLibrary(store)).map((s) => s.id)).toEqual(["l"]);
  });

  it("hides server entries on delete (undo shows them again) and renames them locally", async () => {
    const store = memoryStore();
    await syncLibrary(store, { listItems: async () => ({ ok: true as const, data: [hit()] }) }, "session");
    const [server] = await loadSessionLibrary(store);
    const undo = await deleteSessionEntry(store, server!);
    expect(undo).toEqual({ hiddenItemId: "srv-1" });
    expect(await loadSessionLibrary(store)).toEqual([]);
    await undoSessionDelete(store, undo);
    expect(await loadSessionLibrary(store)).toHaveLength(1);

    await renameSessionEntry(store, server!, "Mein Abend");
    const after = await loadSessionLibrary(store);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ title: "Mein Abend", item_id: "srv-1", origin: "local" });
  });
});

/* ---------- the panel against a fake chrome.* ---------- */

function fakeChrome(initial: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...initial };
  const listeners = new Set<() => void>();
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  const chrome = {
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: data[k] })),
        set: vi.fn(async (o: Record<string, unknown>) => {
          Object.assign(data, o);
          listeners.forEach((l) => l());
        }),
        remove: vi.fn(async () => undefined),
      },
      onChanged: { addListener: (l: () => void) => listeners.add(l), removeListener: (l: () => void) => listeners.delete(l) },
    },
    tabs: {
      query: vi.fn(async () => [
        { id: 1, windowId: 7, url: "https://a.dev/", title: "A", highlighted: true },
        { id: 2, windowId: 7, url: "chrome://settings", title: "Settings" },
      ]),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      onCreated: event(),
      onRemoved: event(),
      onUpdated: event(),
    },
    windows: { getCurrent: vi.fn(async () => ({ id: 7 })), create: vi.fn(async () => ({})) },
    runtime: { sendMessage: vi.fn(async () => ({ ok: true, saved: 1, closed: 1 })) },
  };
  return { chrome, data };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear(); // collapsed collections are remembered per browser
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const byText = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

async function mount(sessions: SavedSession[], extra: Record<string, unknown> = {}) {
  const fake = fakeChrome({ "library.sessions": sessions, ...extra });
  vi.stubGlobal("chrome", fake.chrome);
  const { SessionsPanel } = await import("../src/ui/SessionsPanel");
  await act(async () => root.render(<SessionsPanel baseUrl="https://kortex.example.com" />));
  await flush();
  return fake;
}

const menuPick = async (scope: ParentNode, menu: string, item: string) => {
  await act(async () => scope.querySelector<HTMLButtonElement>(`button[aria-label="${menu}"]`)!.click());
  const entry = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes(item));
  if (!entry) throw new Error(`menu item ${item} missing`);
  await act(async () => entry.click());
  await flush();
};
const toastText = async () => {
  await flush();
  await flush();
  return host.querySelector("[data-sonner-toaster]")?.textContent ?? "";
};

describe("sessions panel", () => {
  it("shows the empty state and saves the window's savable tabs", async () => {
    const fake = await mount([]);
    expect(host.textContent).toContain("Noch keine Sessions");
    expect(host.querySelector(".kx-tm-open .kx-tm-count")!.textContent).toBe("1");
    expect(host.textContent).toContain("+1 intern");
    await act(async () => byText("speichern & schließen").click());
    expect(fake.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "kortex/save-session", windowId: 7, tabIds: [1], close: true, windowName: undefined });
    expect(await toastText()).toContain("1 Tab gespeichert und geschlossen");
    await act(async () => byText("Nur speichern").click());
    expect(fake.chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ type: "kortex/save-session", windowId: 7, tabIds: [1], close: false, windowName: undefined });
  });

  it("offers to reopen closed tabs and says why tabs stayed open", async () => {
    const fake = await mount([]);
    fake.chrome.runtime.sendMessage.mockResolvedValueOnce({ ok: true, saved: 1, closed: 1, itemId: "i1", closedTabs: [{ url: "https://a.dev/" }] } as never);
    await act(async () => byText("speichern & schließen").click());
    expect(await toastText()).toContain("Wiederherstellen");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("[data-sonner-toaster] button")].find((b) => b.textContent === "Wiederherstellen")!.click());
    expect(fake.chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ type: "kortex/reopen-tabs", windowId: 7, urls: ["https://a.dev/"] });

    fake.chrome.runtime.sendMessage.mockResolvedValueOnce({ ok: true, saved: 1, closed: 0, itemId: "i2", keptOpen: 1 } as never);
    await act(async () => byText("speichern & schließen").click());
    expect(await toastText()).toContain("gespeichert, Tabs blieben offen");
  });

  it("renders a collection with tab cards, collapses it and runs the actions", async () => {
    const fake = await mount([session({ item_id: "it-9" })]);
    expect(host.querySelector(".kx-tm-sname")!.textContent).toBe("Recherche"); // the time stamp moves to the meta line

    const head = host.querySelector<HTMLButtonElement>(".kx-tm-stitle")!;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    const cards = () => host.querySelectorAll<HTMLButtonElement>(".kx-tm-session .kx-tm-cardbtn");
    expect(cards()).toHaveLength(3);

    // collapsed: a favicon strip, remembered for the next visit
    await act(async () => head.click());
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll(".kx-tm-strip img")).toHaveLength(1); // a.dev; b.dev falls back to the globe
    expect(host.querySelectorAll(".kx-tm-strip svg")).toHaveLength(1);
    expect(localStorage.getItem("kortex.sp.collapsed")).toContain("it-9");
    await act(async () => head.click());
    await act(async () => cards()[0]!.click());
    expect(fake.chrome.tabs.create).toHaveBeenLastCalledWith({ url: "https://www.a.dev/x", active: false });

    await act(async () => byText("Öffnen").click());
    expect(fake.chrome.windows.create).toHaveBeenCalledWith({ url: ["https://www.a.dev/x", "https://a.dev/y", "https://b.dev/"] });

    const block = host.querySelector(".kx-tm-session")!;
    await menuPick(block, "Session-Aktionen", "In Kortex öffnen");
    expect(fake.chrome.tabs.create).toHaveBeenLastCalledWith({ url: "https://kortex.example.com/notes/it-9" });
  });

  it("deletes with undo", async () => {
    const fake = await mount([session(), session({ id: "s2", title: "Zweite" })]);
    await menuPick(host.querySelector(".kx-tm-session")!, "Session-Aktionen", "Session löschen");
    expect((fake.data["library.sessions"] as SavedSession[]).map((s) => s.id)).toEqual(["s2"]);
    expect(await toastText()).toContain("gelöscht");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("[data-sonner-toaster] button")].find((b) => b.textContent === "Rückgängig")!.click());
    await flush();
    expect((fake.data["library.sessions"] as SavedSession[]).map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("shows sessions saved elsewhere in Kortex next to the local ones", async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true, query: "", mode: "recent", results: [hit({ item_id: "web-1", title: "Aus dem Web" })] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount([session()], { settings: { mockMode: false, baseUrl: "https://kortex.example.com", token: "kx_test" } });
    await flush();
    expect(fetchMock).toHaveBeenCalled();
    expect(host.textContent).toContain("Mit Kortex abgeglichen");
    expect(host.textContent).toContain("Aus dem Web");
    expect(host.textContent).toContain("aus Kortex");
    expect(host.querySelectorAll(".kx-tm-session")).toHaveLength(2);
    const web = [...host.querySelectorAll(".kx-tm-session")].find((b) => b.textContent?.includes("Aus dem Web"))!;
    await act(async () => web.querySelector<HTMLButtonElement>('button[aria-label="Session-Aktionen"]')!.click());
    expect(host.textContent).toContain("Aus der Liste entfernen");
  });

  it("falls back to the local list when Kortex is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await mount([session()], { settings: { mockMode: false, baseUrl: "https://kortex.example.com", token: "kx_test" } });
    await flush();
    expect(host.textContent).toContain("Offline");
    expect(host.querySelectorAll(".kx-tm-session")).toHaveLength(1);
  });

  it("reorders by keyboard, moves a tab through the menu and removes a tab", async () => {
    const a = session({ id: "a", title: "Alpha", tabs: [{ url: "https://a1.dev/" }, { url: "https://a2.dev/" }] });
    const b = session({ id: "b", title: "Beta", saved_at: new Date(now.getTime() - 3_600_000).toISOString(), tabs: [{ url: "https://b1.dev/" }] });
    const fake = await mount([a, b]);
    const blocks = () => [...host.querySelectorAll<HTMLElement>(".kx-tm-session")];
    const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, altKey: true, bubbles: true })));

    await key(blocks()[1]!.querySelector(".kx-tm-stitle")!, "ArrowUp");
    await flush();
    expect(fake.data["library.sessionOrder"]).toEqual(["b", "a"]);
    expect(blocks()[0]!.textContent).toContain("Beta");
    expect(await toastText()).toContain("Session auf Platz 1 von 2");

    const alpha = () => blocks().find((c) => c.textContent?.includes("Alpha"))!;
    await key(alpha().querySelectorAll(".kx-tm-cardbtn")[1]!, "ArrowUp");
    await flush();
    expect((fake.data["library.sessions"] as SavedSession[]).find((s) => s.id === "a")!.tabs.map((t) => t.url)).toEqual(["https://a2.dev/", "https://a1.dev/"]);

    const card = alpha().querySelectorAll(".kx-tm-card")[0]!;
    await menuPick(card, "Verschieben nach …", "Beta");
    const saved = fake.data["library.sessions"] as SavedSession[];
    expect(saved.find((s) => s.id === "a")!.tabs.map((t) => t.url)).toEqual(["https://a1.dev/"]);
    expect(saved.find((s) => s.id === "b")!.tabs.map((t) => t.url)).toEqual(["https://b1.dev/", "https://a2.dev/"]);

    await act(async () => alpha().querySelector<HTMLButtonElement>('button[aria-label="Aus Session entfernen"]')!.click());
    await flush();
    expect((fake.data["library.sessions"] as SavedSession[]).find((s) => s.id === "a")!.tabs).toEqual([]);
  });

  it("adds an open tab to a session from its menu and closes an open tab", async () => {
    const fake = await mount([session({ id: "a", title: "Alpha", tabs: [{ url: "https://z.dev/" }] })]);
    await menuPick(host.querySelector(".kx-tm-open")!, "Zu Session hinzufügen", "Alpha");
    expect((fake.data["library.sessions"] as SavedSession[])[0]!.tabs.map((t) => t.url)).toEqual(["https://z.dev/", "https://a.dev/"]);
    expect(await toastText()).toContain("1 Tab zu „Alpha“ hinzugefügt");
    await act(async () => button("Tab schließen").click());
    expect(fake.chrome.tabs.remove).toHaveBeenCalledWith(1);
  });

  it("closes an open tab once it is added to a session, with Restore", async () => {
    const fake = await mount([session({ id: "a", title: "Alpha", tabs: [] })]);
    fake.chrome.runtime.sendMessage.mockImplementation((async (m: { type: string }) => (m.type === "kortex/close-tabs" ? [1] : null)) as never);
    await menuPick(host.querySelector(".kx-tm-open")!, "Zu Session hinzufügen", "Alpha");
    expect(fake.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "kortex/close-tabs", windowId: 7, tabIds: [1] });
    expect(await toastText()).toContain("1 Tab nach „Alpha“ verschoben und geschlossen");
    await act(async () => byText("Wiederherstellen").click());
    expect(fake.chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ type: "kortex/reopen-tabs", windowId: 7, urls: ["https://a.dev/"] });
  });

  it("keeps the tab open when closing after a drop is turned off", async () => {
    const fake = await mount([session({ id: "a", title: "Alpha", tabs: [] })], { settings: { closeOnDrop: false } });
    await menuPick(host.querySelector(".kx-tm-open")!, "Zu Session hinzufügen", "Alpha");
    expect(fake.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "kortex/close-tabs" }));
    expect(await toastText()).toContain("1 Tab zu „Alpha“ hinzugefügt");
  });

  it("picks tabs and saves only the selection", async () => {
    const fake = await mount([]);
    await act(async () => byText("Auswählen").click());
    expect(host.querySelector<HTMLInputElement>(".kx-tm-pick")!.checked).toBe(true);
    await act(async () => byText("Keine").click());
    expect(byText("Keine Tabs ausgewählt").disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>(".kx-tm-pick")!.click());
    await act(async () => byText("speichern & schließen").click());
    expect(fake.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "kortex/save-session", windowId: 7, tabIds: [1], close: true, windowName: undefined });
  });

  it("renames inline; Escape cancels", async () => {
    const fake = await mount([session()]);
    await menuPick(host.querySelector(".kx-tm-session")!, "Session-Aktionen", "Umbenennen");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Neuer Name"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "Abbruch");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect((fake.data["library.sessions"] as SavedSession[])[0]!.title).toBe(session().title);

    await menuPick(host.querySelector(".kx-tm-session")!, "Session-Aktionen", "Umbenennen");
    const again = host.querySelector<HTMLInputElement>('input[aria-label="Neuer Name"]')!;
    await act(async () => {
      setValue.call(again, "Urlaub planen");
      again.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await flush();
    expect((fake.data["library.sessions"] as SavedSession[])[0]!.title).toBe("Urlaub planen");
  });
});
