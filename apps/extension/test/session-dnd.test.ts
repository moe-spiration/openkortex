// Duplikate zusammenführen und Drag & Drop (Tabs verschieben, Sessions umsortieren, offene Tabs einfügen).
import { describe, expect, it } from "vitest";
import {
  addTabsToSession,
  confirmSessionItem,
  deleteSessionEntry,
  applySessionOrder,
  dedupeSessions,
  loadSessionLibrary,
  mergeSessions,
  moveItem,
  moveTabBetween,
  removeTabAt,
  shiftKey,
  readSessions,
  rememberSession,
  reorderKeys,
  saveSessionEdits,
  saveSessionOrder,
  sessionKey,
  type SavedSession,
} from "../src/lib/library";
import { resolveDrop, tabDndId } from "../src/lib/session-dnd";
import { memoryStore } from "../src/lib/settings";

const T0 = Date.parse("2026-11-03T10:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const tabs = (...hosts: string[]) => hosts.map((h) => ({ url: `https://${h}/`, title: h }));
const sess = (id: string, hosts: string[], over: Partial<SavedSession> = {}): SavedSession => ({ id, title: `S ${id}`, saved_at: at(0), tabs: tabs(...hosts), ...over });

describe("Duplikate zusammenführen", () => {
  it("gleiche Tab-Menge im selben Zeitfenster ist eine Session, auch bei anderer Reihenfolge", () => {
    const out = dedupeSessions([sess("a", ["x.dev", "y.dev"]), sess("b", ["y.dev", "x.dev"], { saved_at: at(1) })]);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });

  it("andere Tabs oder ein anderes Zeitfenster bleiben getrennt", () => {
    expect(dedupeSessions([sess("a", ["x.dev"]), sess("b", ["x.dev", "y.dev"])])).toHaveLength(2);
    expect(dedupeSessions([sess("a", ["x.dev"]), sess("b", ["x.dev"], { saved_at: at(30) })])).toHaveLength(2);
  });

  it("zwei lokale Einträge mit derselben item_id (Server hat gemerged) werden einer", () => {
    const out = dedupeSessions([sess("a", ["x.dev"], { item_id: "it1" }), sess("b", ["x.dev", "z.dev"], { item_id: "it1", saved_at: at(90) })]);
    expect(out).toHaveLength(1);
  });

  it("lokaler Eintrag und Server-Eintrag mit anderer item_id, aber gleichen Tabs, erscheinen einmal und behalten die item_id", () => {
    const local = [sess("a", ["x.dev"])];
    const remote = [sess("kortex:srv", ["x.dev"], { item_id: "srv", saved_at: at(2) })];
    const merged = mergeSessions(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "a", item_id: "srv" });
  });

  it("rememberSession legt dieselbe Session zweimal (anderer Idempotency-Key) nur einmal ab", async () => {
    const store = memoryStore();
    const t = tabs("x.dev", "y.dev");
    await rememberSession(store, t.map((x) => ({ url: x.url, title: x.title })), { id: "k1", title: "S", saved_at: at(0) });
    await rememberSession(store, t.map((x) => ({ url: x.url, title: x.title })), { id: "k2", title: "S", saved_at: at(0), item_id: "it1" });
    const list = await readSessions(store);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "k1", item_id: "it1" });
  });
});

describe("Offline eingereihte Sessions", () => {
  it("bekommen nach der Zustellung ihre item_id und stehen nicht neben dem Server-Eintrag", async () => {
    const store = memoryStore();
    await store.set("library.sessions", [sess("k1", ["x.dev"], { title: "Lokaler Titel" })]);
    await confirmSessionItem(store, "k1", "it9");
    await store.set("library.remote.sessions", [sess("kortex:it9", ["x.dev"], { item_id: "it9", title: "Anderer Titel" })]);
    const list = await loadSessionLibrary(store);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "k1", item_id: "it9" });
  });

  it("eine vor der Zustellung gelöschte Session taucht danach nicht wieder auf", async () => {
    const store = memoryStore();
    const e = sess("k1", ["x.dev"]);
    await store.set("library.sessions", [e]);
    await deleteSessionEntry(store, e);
    await confirmSessionItem(store, "k1", "it9");
    await store.set("library.remote.sessions", [sess("kortex:it9", ["x.dev"], { item_id: "it9" })]);
    expect(await loadSessionLibrary(store)).toEqual([]);
  });
});

describe("Umsortieren", () => {
  it("moveItem und reorderKeys", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorderKeys(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderKeys(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });

  it("applySessionOrder: gespeicherte Reihenfolge, neue Sessions zuerst", () => {
    const list = [sess("n", ["n.dev"]), sess("a", ["a.dev"]), sess("b", ["b.dev"])];
    expect(applySessionOrder(list, ["b", "a"]).map((s) => s.id)).toEqual(["n", "b", "a"]);
    expect(applySessionOrder(list, []).map((s) => s.id)).toEqual(["n", "a", "b"]);
  });

  it("die Reihenfolge bleibt im Speicher und gilt für lokale und Server-Sessions", async () => {
    const store = memoryStore();
    await store.set("library.sessions", [sess("a", ["a.dev"], { saved_at: at(10) })]);
    await store.set("library.remote.sessions", [sess("kortex:s", ["s.dev"], { item_id: "s", saved_at: at(0) })]);
    expect((await loadSessionLibrary(store)).map(sessionKey)).toEqual(["a", "s"]);
    await saveSessionOrder(store, ["s", "a"]);
    expect((await loadSessionLibrary(store)).map(sessionKey)).toEqual(["s", "a"]);
  });
});

describe("Tabs verschieben", () => {
  const all = [sess("a", ["1.dev", "2.dev", "3.dev"]), sess("b", ["4.dev"])];

  it("zwischen Sessions: raus aus der Quelle, rein an die Position", () => {
    const [a, b] = moveTabBetween(all, { sessionKey: "a", index: 1 }, { sessionKey: "b", index: 0 })!;
    expect(a!.tabs.map((t) => t.title)).toEqual(["1.dev", "3.dev"]);
    expect(b!.tabs.map((t) => t.title)).toEqual(["2.dev", "4.dev"]);
  });

  it("ohne Index wird angehängt, eine vorhandene URL im Ziel wird nicht doppelt", () => {
    const [, b] = moveTabBetween(all, { sessionKey: "a", index: 0 }, { sessionKey: "b" })!;
    expect(b!.tabs.map((t) => t.title)).toEqual(["4.dev", "1.dev"]);
    const dup = [sess("a", ["1.dev"]), sess("b", ["1.dev"])];
    const res = moveTabBetween(dup, { sessionKey: "a", index: 0 }, { sessionKey: "b" })!;
    expect(res).toHaveLength(1);
    expect(res[0]!.tabs).toEqual([]);
  });

  it("innerhalb einer Session umsortieren (Einfügeposition vor dem Entfernen)", () => {
    const [a] = moveTabBetween(all, { sessionKey: "a", index: 0 }, { sessionKey: "a", index: 3 })!;
    expect(a!.tabs.map((t) => t.title)).toEqual(["2.dev", "3.dev", "1.dev"]);
    expect(moveTabBetween(all, { sessionKey: "a", index: 1 }, { sessionKey: "a", index: 2 })).toBeNull();
  });

  it("unbekannte Quelle ergibt null", () => {
    expect(moveTabBetween(all, { sessionKey: "zz", index: 0 }, { sessionKey: "a" })).toBeNull();
    expect(moveTabBetween(all, { sessionKey: "a", index: 9 }, { sessionKey: "b" })).toBeNull();
  });
});

describe("Offene Tabs in eine Session", () => {
  it("fügt nur neue http(s)-Tabs ein", () => {
    const s = sess("a", ["1.dev", "2.dev"]);
    const out = addTabsToSession(s, [{ url: "https://1.dev/" }, { url: "chrome://x" }, { url: "https://n.dev/", title: "N", favIconUrl: "https://n.dev/f.ico" }], 1)!;
    expect(out.tabs.map((t) => t.url)).toEqual(["https://1.dev/", "https://n.dev/", "https://2.dev/"]);
    expect(out.tabs[1]).toMatchObject({ title: "N", favicon: "https://n.dev/f.ico" });
    expect(addTabsToSession(s, [{ url: "https://1.dev/" }])).toBeNull();
  });
});

describe("Persistenz", () => {
  it("Bearbeitung einer Server-Session wird als lokale Kopie gespeichert und gewinnt gegen den Server", async () => {
    const store = memoryStore();
    const remote = sess("kortex:s", ["a.dev", "b.dev"], { item_id: "s" });
    await store.set("library.remote.sessions", [remote]);
    const [view] = await loadSessionLibrary(store);
    const edited = moveTabBetween([view!], { sessionKey: "s", index: 0 }, { sessionKey: "s", index: 2 })!;
    await saveSessionEdits(store, edited);
    const [after] = await loadSessionLibrary(store);
    expect(after!.tabs.map((t) => t.title)).toEqual(["b.dev", "a.dev"]);
    expect(after).toMatchObject({ item_id: "s", origin: "local" });
    expect(await loadSessionLibrary(store)).toHaveLength(1);
  });

  it("stabile Karten-ids, auch bei doppelten URLs", () => {
    const list = [{ url: "https://a.dev/" }, { url: "https://b.dev/" }, { url: "https://a.dev/" }];
    expect(new Set(list.map((_, i) => tabDndId("k", list, i))).size).toBe(3);
    expect(tabDndId("k", list, 1)).toBe(tabDndId("k", [{ url: "https://b.dev/" }], 0));
  });
});

describe("resolveDrop (dnd-kit)", () => {
  const a = sess("a", ["a1.dev", "a2.dev", "a3.dev"], { title: "Alpha" });
  const b = sess("b", ["b1.dev"], { title: "Beta" });
  const all = [a, b];
  const urls = (r: ReturnType<typeof resolveDrop>, id: string) =>
    r?.type === "edit" ? r.sessions.find((s) => s.id === id)?.tabs.map((t) => t.url.replace("https://", "").replace("/", "")) : undefined;

  it("sortiert in derselben Session wie arrayMove (das Ziel nimmt den Platz ein)", () => {
    const down = resolveDrop({ kind: "tab", sessionKey: "a", index: 0 }, { kind: "tab", sessionKey: "a", index: 2 }, all);
    expect(urls(down, "a")).toEqual(["a2.dev", "a3.dev", "a1.dev"]);
    const up = resolveDrop({ kind: "tab", sessionKey: "a", index: 2 }, { kind: "tab", sessionKey: "a", index: 0 }, all);
    expect(urls(up, "a")).toEqual(["a3.dev", "a1.dev", "a2.dev"]);
    expect(resolveDrop({ kind: "tab", sessionKey: "a", index: 1 }, { kind: "tab", sessionKey: "a", index: 1 }, all)).toBeNull();
  });

  it("verschiebt in eine andere Session: vor den Ziel-Tab oder hinten an", () => {
    const before = resolveDrop({ kind: "tab", sessionKey: "a", index: 1 }, { kind: "tab", sessionKey: "b", index: 0 }, all);
    expect(urls(before, "b")).toEqual(["a2.dev", "b1.dev"]);
    expect(urls(before, "a")).toEqual(["a1.dev", "a3.dev"]);
    expect(before).toMatchObject({ message: "Tab nach „Beta“ verschoben" });
    const append = resolveDrop({ kind: "tab", sessionKey: "a", index: 0 }, { kind: "session", sessionKey: "b" }, all);
    expect(urls(append, "b")).toEqual(["b1.dev", "a1.dev"]);
    expect(resolveDrop({ kind: "tab", sessionKey: "a", index: 0 }, { kind: "session", sessionKey: "a" }, all)).toBeNull();
  });

  it("sortiert Sessions und legt offene Tabs ab", () => {
    expect(resolveDrop({ kind: "session", sessionKey: "b" }, { kind: "session", sessionKey: "a" }, all)).toEqual({ type: "reorder", keys: ["b", "a"] });
    expect(resolveDrop({ kind: "session", sessionKey: "b" }, { kind: "tab", sessionKey: "a", index: 2 }, all)).toEqual({ type: "reorder", keys: ["b", "a"] });
    const tab = { url: "https://n.dev/", title: "N" };
    expect(resolveDrop({ kind: "open", tab }, { kind: "tab", sessionKey: "b", index: 0 }, all)).toEqual({ type: "add-open", tabs: [tab], sessionKey: "b", index: 0 });
    expect(resolveDrop({ kind: "open", tab }, { kind: "session", sessionKey: "a" }, all)).toEqual({ type: "add-open", tabs: [tab], sessionKey: "a" });
    expect(resolveDrop({ kind: "open", tab }, { kind: "new" }, all)).toEqual({ type: "new-session", tabs: [tab] });
    expect(resolveDrop({ kind: "open", tab }, null, all)).toBeNull();
  });
});

describe("keyboard edits", () => {
  it("shifts a key by one place and stops at the edges", () => {
    expect(shiftKey(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(shiftKey(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(shiftKey(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(shiftKey(["a", "b"], "x", 1)).toEqual(["a", "b"]);
  });

  it("removes one tab and ignores a missing index", () => {
    const s = { id: "s", title: "S", saved_at: "", tabs: [{ url: "https://a.dev/" }, { url: "https://b.dev/" }] };
    expect(removeTabAt(s, 0)!.tabs).toEqual([{ url: "https://b.dev/" }]);
    expect(removeTabAt(s, 5)).toBeNull();
  });
});
