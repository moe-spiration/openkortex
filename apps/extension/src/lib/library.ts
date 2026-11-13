// Sessions und Prompts im Side-Panel: lokaler Index (von dieser Extension gespeichert, chrome.storage.local)
// plus die Items aus Kortex (`GET /api/search?type=session|prompt`, Token-Scope `search`), also auch Sessions und
// Prompts aus Web, Desktop oder MCP. Die Server-Liste wird lokal zwischengespeichert, offline zeigt das Panel den
// letzten Stand und alles Lokale. Dedupliziert wird über die item_id (lokale Einträge kennen sie, sobald der Server
// bestätigt hat), sonst über den Titel (Session) bzw. Titel + Text (Prompt).
import type { ApiResult, SearchHit } from "./api";
import type { KeyValueStore } from "./settings";
import { extractVariables } from "./prompts";
import type { TabInfo } from "./sessions";

export type LibraryOrigin = "local" | "server";

export interface SavedSession {
  id: string; // idempotency_key der Anfrage, bei Server-Einträgen `kortex:<item_id>`
  title: string;
  /** ISO-Zeit; leer, wenn ein Server-Eintrag keinen erkennbaren Zeitstempel hat. */
  saved_at: string;
  tabs: { url: string; title?: string; favicon?: string }[];
  /** Server-Item, sobald die Session bestätigt gespeichert ist (fehlt bei offline eingereihten und älteren Einträgen). */
  item_id?: string;
  /** Nur in der gemischten Ansicht gesetzt: woher der Eintrag kommt. */
  origin?: LibraryOrigin;
}

export interface SavedPrompt {
  id: string;
  title: string;
  text: string;
  variables: string[];
  saved_at: string;
  item_id?: string;
  origin?: LibraryOrigin;
}

const SESSIONS = "library.sessions";
const PROMPTS = "library.prompts";
const REMOTE = { session: "library.remote.sessions", prompt: "library.remote.prompts" } as const;
const HIDDEN = "library.hidden";
const ORDER = "library.sessionOrder";
const DELETED = "library.deletedKeys";
const MAX = 200;

export const readSessions = async (s: KeyValueStore) => (await s.get<SavedSession[]>(SESSIONS)) ?? [];
export const readPrompts = async (s: KeyValueStore) => (await s.get<SavedPrompt[]>(PROMPTS)) ?? [];

async function upsert<T extends { id: string }>(s: KeyValueStore, key: string, entry: T) {
  const list = (await s.get<T[]>(key)) ?? [];
  await s.set(key, [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX));
}

/** Gleiche Tab-Menge im selben Zeitfenster ist dieselbe Session (Doppelklick, Retry, zwei Pfade). */
export const SAME_SESSION_WINDOW_MS = 5 * 60_000;

/** Sortierte, eindeutige URL-Menge: gleiche Tabs in beliebiger Reihenfolge ergeben denselben Schlüssel. */
export const tabSetKey = (tabs: readonly { url: string }[]) => [...new Set(tabs.map((t) => t.url))].sort().join("\n");

const sameTabsNearby = (a: SavedSession, b: SavedSession) => {
  if (a.tabs.length === 0 || tabSetKey(a.tabs) !== tabSetKey(b.tabs)) return false;
  const ta = Date.parse(a.saved_at);
  const tb = Date.parse(b.saved_at);
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= SAME_SESSION_WINDOW_MS;
};

export async function rememberSession(s: KeyValueStore, tabs: readonly TabInfo[], meta: Omit<SavedSession, "tabs" | "origin">) {
  const entry: SavedSession = {
    ...meta,
    tabs: tabs.flatMap((t) => (t.url ? [{ url: t.url, ...(t.title ? { title: t.title } : {}), ...(t.favIconUrl ? { favicon: t.favIconUrl } : {}) }] : [])),
  };
  const list = (await s.get<SavedSession[]>(SESSIONS)) ?? [];
  const twin = list.find((e) => e.id !== entry.id && ((entry.item_id && e.item_id === entry.item_id) || sameTabsNearby(e, entry)));
  // Der Zwilling bleibt (Name, Position), nimmt aber die Server-Bestätigung mit.
  if (twin) {
    if (entry.item_id && !twin.item_id) await s.set(SESSIONS, list.map((e) => (e === twin ? { ...e, item_id: entry.item_id } : e)));
    return;
  }
  await s.set(SESSIONS, [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX));
}

export const rememberPrompt = (s: KeyValueStore, p: Omit<SavedPrompt, "variables" | "origin">) =>
  upsert<SavedPrompt>(s, PROMPTS, { ...p, variables: extractVariables(p.text) });

export async function removeSession(s: KeyValueStore, id: string) {
  await s.set(SESSIONS, (await readSessions(s)).filter((e) => e.id !== id));
}
/** Benennt nur den lokalen Eintrag um (die Notiz in Kortex behält ihren Titel). Leerer Name = keine Änderung. */
export async function renameSession(s: KeyValueStore, id: string, title: string) {
  const name = title.replace(/\s+/g, " ").trim();
  if (!name) return;
  await s.set(SESSIONS, (await readSessions(s)).map((e) => (e.id === id ? { ...e, title: name.slice(0, 300) } : e)));
}
/** Rückgängig nach dem Löschen: legt den Eintrag an seiner alten Position wieder ab (nie doppelt). */
export async function restoreSession(s: KeyValueStore, entry: SavedSession, index: number) {
  const list = (await readSessions(s)).filter((e) => e.id !== entry.id);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, entry);
  await s.set(SESSIONS, list.slice(0, MAX));
}
export async function removePrompt(s: KeyValueStore, id: string) {
  await s.set(PROMPTS, (await readPrompts(s)).filter((e) => e.id !== id));
}

/* ---------- server items ---------- */

const strip = <T extends { origin?: LibraryOrigin }>(e: T): Omit<T, "origin"> => {
  const rest = { ...e };
  delete rest.origin;
  return rest;
};

/** `- [Titel](<url>)` bzw. `- [Titel](url)` aus der Session-Notiz; `\[`-Escapes werden aufgelöst. */
export function parseLinkList(md: string): { url: string; title?: string }[] {
  const out: { url: string; title?: string }[] = [];
  for (const m of md.matchAll(/^\s*[-*+]\s+\[((?:\\.|[^\]\\])*)\]\(<?(https?:\/\/[^\s>)]+)>?\)/gim)) {
    const title = m[1]!.replace(/\\(.)/g, "$1").trim();
    out.push({ url: m[2]!, ...(title ? { title } : {}) });
  }
  return out;
}

/** Zeitstempel aus dem Session-Titel ("Session 2026-10-31 14:05", UTC wie in sessionTitle), sonst leer. */
export function savedAtFromTitle(title: string): string {
  const m = /Session (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(title);
  if (!m) return "";
  const d = new Date(`${m[1]}T${m[2]}:00.000Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function sessionFromHit(h: SearchHit): SavedSession {
  return { id: `kortex:${h.item_id}`, title: h.title, saved_at: savedAtFromTitle(h.title), tabs: parseLinkList(h.content_md ?? ""), item_id: h.item_id };
}

export function promptFromHit(h: SearchHit): SavedPrompt {
  const text = (h.content_md ?? "").trim();
  return { id: `kortex:${h.item_id}`, title: h.title, text, variables: extractVariables(text), saved_at: "", item_id: h.item_id };
}

export const readRemoteSessions = async (s: KeyValueStore) => (await s.get<SavedSession[]>(REMOTE.session)) ?? [];
export const readRemotePrompts = async (s: KeyValueStore) => (await s.get<SavedPrompt[]>(REMOTE.prompt)) ?? [];
export const readSessionOrder = async (s: KeyValueStore) => (await s.get<string[]>(ORDER)) ?? [];
export const readHidden = async (s: KeyValueStore) => (await s.get<string[]>(HIDDEN)) ?? [];

async function setHidden(s: KeyValueStore, itemId: string, hidden: boolean) {
  const list = (await readHidden(s)).filter((id) => id !== itemId);
  await s.set(HIDDEN, hidden ? [itemId, ...list].slice(0, 1000) : list);
}

/** Neueste zuerst, Einträge ohne Datum ans Ende (stabil). */
const byDate = <T extends { saved_at: string }>(list: T[]) =>
  list
    .map((e, i) => ({ e, i, t: e.saved_at ? Date.parse(e.saved_at) || 0 : -Infinity }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.e);

function merge<T extends { item_id?: string; origin?: LibraryOrigin }>(
  local: readonly T[],
  remote: readonly T[],
  hidden: readonly string[],
  same: (local: T, remote: T) => boolean,
): T[] {
  const off = new Set(hidden);
  const mine = local.filter((e) => !e.item_id || !off.has(e.item_id)).map((e) => ({ ...e, origin: "local" as const }));
  const theirs: T[] = [];
  for (const r of remote) {
    if (r.item_id && off.has(r.item_id)) continue;
    const twin = mine.find((l) => (l.item_id ? l.item_id === r.item_id : same(l, r)));
    if (twin) {
      if (!twin.item_id && r.item_id) twin.item_id = r.item_id; // offline gespeichert, inzwischen in Kortex
      continue;
    }
    theirs.push({ ...r, origin: "server" });
  }
  return [...mine, ...theirs];
}

/** Schlüssel einer Session in der manuellen Reihenfolge. */
export const sessionKey = (s: Pick<SavedSession, "id" | "item_id">) => s.item_id ?? s.id;

/**
 * Führt Duplikate in der Anzeige zusammen: gleiche item_id (der Server hat doppelte Saves zu einem Item gemerged)
 * oder gleiche Tab-Menge im selben Zeitfenster. Der erste (lokale, sonst neueste) Eintrag bleibt und übernimmt die item_id.
 */
export function dedupeSessions<T extends SavedSession>(list: readonly T[]): T[] {
  // Lokale Einträge zuerst prüfen, damit ihre Änderungen (Name, verschobene Tabs) gegen den Server-Zwilling gewinnen;
  // die Reihenfolge der Liste bleibt erhalten.
  const out: T[] = [];
  const dropped = new Set<T>();
  const order = [...list].sort((x, y) => Number(y.origin === "local") - Number(x.origin === "local"));
  for (const e of order) {
    const twin = out.find((o) => (e.item_id && o.item_id === e.item_id) || sameTabsNearby(o, e));
    if (twin) {
      if (!twin.item_id && e.item_id) twin.item_id = e.item_id;
      dropped.add(e);
    } else out.push({ ...e });
  }
  return list.flatMap((e) => (dropped.has(e) ? [] : [out.find((o) => o.id === e.id)!]));
}

/** Manuelle Reihenfolge: bekannte Schlüssel in gespeicherter Reihenfolge, neue (unbekannte) Sessions oben. */
export function applySessionOrder<T extends SavedSession>(list: readonly T[], order: readonly string[]): T[] {
  if (!order.length) return [...list];
  const rank = new Map(order.map((k, i) => [k, i]));
  const fresh = list.filter((e) => !rank.has(sessionKey(e)));
  const known = list.filter((e) => rank.has(sessionKey(e))).sort((a, b) => rank.get(sessionKey(a))! - rank.get(sessionKey(b))!);
  return [...fresh, ...known];
}

export const mergeSessions = (local: readonly SavedSession[], remote: readonly SavedSession[], hidden: readonly string[] = [], order: readonly string[] = []) =>
  applySessionOrder(dedupeSessions(byDate(merge(local, remote, hidden, (l, r) => l.title === r.title))), order);

export const mergePrompts = (local: readonly SavedPrompt[], remote: readonly SavedPrompt[], hidden: readonly string[] = []) =>
  merge(local, remote, hidden, (l, r) => l.title === r.title && l.text.trim() === r.text.trim());

/** Was das Side-Panel zeigt: lokal + zwischengespeicherte Server-Liste, ohne ausgeblendete Items. */
export async function loadSessionLibrary(s: KeyValueStore) {
  const [local, remote, hidden, order] = await Promise.all([readSessions(s), readRemoteSessions(s), readHidden(s), readSessionOrder(s)]);
  return mergeSessions(local, remote, hidden, order);
}
export async function loadPromptLibrary(s: KeyValueStore) {
  const [local, remote, hidden] = await Promise.all([readPrompts(s), readRemotePrompts(s), readHidden(s)]);
  return mergePrompts(local, remote, hidden);
}

export type SyncState =
  | { state: "synced"; count: number }
  /** Mock-Modus oder kein Token: nur der lokale Index. */
  | { state: "local" }
  /** Kortex nicht erreichbar: letzter Server-Stand + lokal. */
  | { state: "offline" }
  | { state: "error"; message: string };

/** Holt die Server-Liste und legt sie lokal ab (das Panel lädt danach über chrome.storage.onChanged neu). */
export async function syncLibrary(
  s: KeyValueStore,
  api: { listItems(type: "prompt" | "session", limit?: number): Promise<ApiResult<SearchHit[]>> },
  type: "session" | "prompt",
): Promise<SyncState> {
  const res = await api.listItems(type).catch((e: unknown): ApiResult<SearchHit[]> => ({ ok: false, error: { code: "network", message: String(e) } }));
  if (res.ok) {
    await s.set(REMOTE[type], type === "session" ? res.data.map(sessionFromHit) : res.data.map(promptFromHit));
    return { state: "synced", count: res.data.length };
  }
  if (res.error.code === "setup_required") {
    await s.remove(REMOTE[type]);
    return { state: "local" };
  }
  if (res.error.code === "network") return { state: "offline" };
  return { state: "error", message: res.error.message };
}

/* ---------- delete / undo / rename across both sources ---------- */

export interface DeleteUndo<T> {
  local?: { entry: T; index: number };
  hiddenItemId?: string;
}

async function deleteEntry<T extends { id: string; item_id?: string; origin?: LibraryOrigin }>(s: KeyValueStore, key: string, entry: T): Promise<DeleteUndo<T>> {
  const list = (await s.get<T[]>(key)) ?? [];
  const index = list.findIndex((e) => e.id === entry.id);
  const undo: DeleteUndo<T> = {};
  // Offline eingereiht und gelöscht: die Zustellung kommt später, das Item soll dann nicht auftauchen (siehe confirmSessionItem).
  if (!entry.item_id) await s.set(DELETED, [entry.id, ...((await s.get<string[]>(DELETED)) ?? []).filter((k) => k !== entry.id)].slice(0, 200));
  if (index >= 0) {
    undo.local = { entry: list[index]!, index };
    await s.set(key, list.filter((e) => e.id !== entry.id));
  }
  // In Kortex bleibt das Item (das Token darf nur speichern und suchen); es wird hier nur ausgeblendet.
  if (entry.item_id) {
    await setHidden(s, entry.item_id, true);
    undo.hiddenItemId = entry.item_id;
  }
  return undo;
}

async function undoDelete<T extends { id: string }>(s: KeyValueStore, key: string, undo: DeleteUndo<T>) {
  if (undo.local) await s.set(DELETED, ((await s.get<string[]>(DELETED)) ?? []).filter((k) => k !== undo.local!.entry.id));
  if (undo.local) {
    const list = ((await s.get<T[]>(key)) ?? []).filter((e) => e.id !== undo.local!.entry.id);
    list.splice(Math.max(0, Math.min(undo.local.index, list.length)), 0, undo.local.entry);
    await s.set(key, list.slice(0, MAX));
  }
  if (undo.hiddenItemId) await setHidden(s, undo.hiddenItemId, false);
}

export const deleteSessionEntry = (s: KeyValueStore, e: SavedSession) => deleteEntry(s, SESSIONS, e);
export const undoSessionDelete = (s: KeyValueStore, u: DeleteUndo<SavedSession>) => undoDelete(s, SESSIONS, u);
export const deletePromptEntry = (s: KeyValueStore, e: SavedPrompt) => deleteEntry(s, PROMPTS, e);
export const undoPromptDelete = (s: KeyValueStore, u: DeleteUndo<SavedPrompt>) => undoDelete(s, PROMPTS, u);

/**
 * Umbenennen gilt nur für diese Extension: Kortex hat keine Item-Änderung mit Token-Zugriff. Ein Server-Eintrag
 * bekommt dafür eine lokale Kopie mit derselben item_id, die in der Ansicht vor der Server-Version gewinnt.
 */
export async function renameSessionEntry(s: KeyValueStore, entry: SavedSession, title: string) {
  const name = title.replace(/\s+/g, " ").trim();
  if (!name) return;
  if ((await readSessions(s)).some((e) => e.id === entry.id)) return renameSession(s, entry.id, name);
  await upsert<SavedSession>(s, SESSIONS, { ...strip(entry), title: name.slice(0, 300) });
}

/** Volltextsuche (Titel, Text, Variablen) für den Prompt-Katalog; leere Anfrage = alles. */
export function searchPrompts<T extends SavedPrompt>(list: readonly T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...list];
  return list.filter((p) => {
    const hay = `${p.title}\n${p.text}\n${p.variables.join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/* ---------- drag & drop (Toby-Stil): Tabs zwischen Sessions, Sessions umsortieren, offene Tabs hineinziehen ---------- */

export type SessionTab = SavedSession["tabs"][number];

/** Verschiebt `fromIndex` an `toIndex` (Index im Ergebnis, begrenzt). */
export function moveItem<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= list.length) return [...list];
  const out = [...list];
  const [it] = out.splice(fromIndex, 1);
  out.splice(Math.max(0, Math.min(toIndex, out.length)), 0, it!);
  return out;
}

/** Neue Reihenfolge der Schlüssel, wenn `fromKey` an die Stelle von `toKey` gezogen wird. */
export function reorderKeys(keys: readonly string[], fromKey: string, toKey: string): string[] {
  const from = keys.indexOf(fromKey);
  const to = keys.indexOf(toKey);
  return from < 0 || to < 0 || from === to ? [...keys] : moveItem(keys, from, to);
}

/**
 * Tab in eine andere oder dieselbe Session ziehen. `to.index` ist die Einfügeposition vor dem Entfernen (in derselben
 * Session wird sie korrigiert), ohne Index wird angehängt. Ergebnis: die geänderten Sessions, `null` wenn nichts zu tun ist.
 * Eine URL, die das Ziel schon hat, wird nicht doppelt eingefügt (der Tab verlässt nur die Quelle).
 */
export function moveTabBetween(
  sessions: readonly SavedSession[],
  from: { sessionKey: string; index: number },
  to: { sessionKey: string; index?: number },
): SavedSession[] | null {
  const src = sessions.find((s) => sessionKey(s) === from.sessionKey);
  const dst = sessions.find((s) => sessionKey(s) === to.sessionKey);
  const tab = src?.tabs[from.index];
  if (!src || !dst || !tab) return null;
  if (src === dst) {
    const at = to.index ?? src.tabs.length;
    const target = at > from.index ? at - 1 : at;
    return target === from.index ? null : [{ ...src, tabs: moveItem(src.tabs, from.index, target) }];
  }
  const without = { ...src, tabs: src.tabs.filter((_, i) => i !== from.index) };
  if (dst.tabs.some((t) => t.url === tab.url)) return [without];
  const at = Math.max(0, Math.min(to.index ?? dst.tabs.length, dst.tabs.length));
  return [without, { ...dst, tabs: [...dst.tabs.slice(0, at), tab, ...dst.tabs.slice(at)] }];
}

/** Einen Tab aus einer Session nehmen; `null`, wenn der Index nicht existiert. */
export function removeTabAt(session: SavedSession, index: number): SavedSession | null {
  if (index < 0 || index >= session.tabs.length) return null;
  return { ...session, tabs: session.tabs.filter((_, i) => i !== index) };
}

/** Tastatur-Umsortieren (Alt+Pfeil): `key` um `delta` Plätze verschieben; unverändert am Rand. */
export function shiftKey(keys: readonly string[], key: string, delta: number): string[] {
  const from = keys.indexOf(key);
  if (from < 0) return [...keys];
  return moveItem(keys, from, Math.max(0, Math.min(keys.length - 1, from + delta)));
}

/** Offene Tabs in eine Session einfügen (nur http(s), ohne URLs, die schon drin sind). */
export function addTabsToSession(session: SavedSession, tabs: readonly TabInfo[], index?: number): SavedSession | null {
  const known = new Set(session.tabs.map((t) => t.url));
  const add: SessionTab[] = [];
  for (const t of tabs) {
    if (!t.url || !/^https?:\/\//i.test(t.url) || known.has(t.url)) continue;
    known.add(t.url);
    add.push({ url: t.url, ...(t.title ? { title: t.title } : {}), ...(t.favIconUrl ? { favicon: t.favIconUrl } : {}) });
  }
  if (!add.length) return null;
  const at = Math.max(0, Math.min(index ?? session.tabs.length, session.tabs.length));
  return { ...session, tabs: [...session.tabs.slice(0, at), ...add, ...session.tabs.slice(at)] };
}

/** Speichert geänderte Sessions lokal (Server-Einträge als lokale Kopie mit derselben item_id, wie beim Umbenennen). */
export async function saveSessionEdits(s: KeyValueStore, edited: readonly SavedSession[]) {
  const list = (await readSessions(s)).slice();
  for (const e of edited) {
    const entry = strip(e);
    const i = list.findIndex((x) => x.id === entry.id);
    if (i >= 0) list[i] = entry;
    else list.unshift(entry);
  }
  await s.set(SESSIONS, list.slice(0, MAX));
}

/**
 * Zustellung einer offline eingereihten Session: der lokale Eintrag bekommt seine item_id (sonst bliebe er neben dem
 * Server-Eintrag stehen). Wurde er inzwischen gelöscht, wird das Item ausgeblendet.
 */
export async function confirmSessionItem(s: KeyValueStore, key: string, itemId: string) {
  const list = await readSessions(s);
  if (list.some((e) => e.id === key)) {
    await s.set(SESSIONS, list.map((e) => (e.id === key && !e.item_id ? { ...e, item_id: itemId } : e)));
  } else if (((await s.get<string[]>(DELETED)) ?? []).includes(key)) {
    await setHidden(s, itemId, true);
  }
}

export const saveSessionOrder = (s: KeyValueStore, keys: readonly string[]) => s.set(ORDER, keys.slice(0, 1000));
