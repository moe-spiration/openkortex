// Tab-Sessions (Toby-Stil): Tabs eines Fensters als ein Item `type: "session"` speichern, erst nach der
// Server-Bestätigung schließen.
import { t } from "../i18n";
import { clientInfo, type NoteRequest } from "./api";
import type { SubmitResult } from "./outbox";
import { EXTENSION_VERSION, newIdempotencyKey } from "./requests";
import { autoSessionName } from "./session-name";

export const SESSION_FOLDER = "30_Clippings/Sessions";
/** Ab dieser Tab-Zahl muss das Schließen bestätigt werden. */
export const CONFIRM_CLOSE_ABOVE = 10;
const MAX_TABS = 500; // Registry: metadata.tabs max 500

export interface TabInfo {
  id?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
  pinned?: boolean;
}

/** Nur http(s): chrome://, about:, file:, extension-Seiten usw. werden nicht erfasst. */
export const isSavableUrl = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url);

export const savableTabs = (tabs: readonly TabInfo[]) => tabs.filter((tab) => isSavableUrl(tab.url)).slice(0, MAX_TABS);

const esc = (s: string) => s.replace(/[[\]\\]/g, "\\$&").replace(/\s+/g, " ").trim();
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

export function sessionTitle(count: number, now: Date, windowName?: string) {
  const name = windowName?.trim();
  return `${name ? `${name} · ` : ""}Session ${stamp(now)} (${count} Tabs)`;
}

/** Markdown-Linkliste `- [Titel](<url>)`, eine Zeile je http(s)-Tab (Session-Notiz und "Als Markdown kopieren"). */
export function markdownLinkList(tabs: readonly { url?: string; title?: string }[]): string {
  return tabs
    .filter((t): t is { url: string; title?: string } => isSavableUrl(t.url))
    .map((t) => `- [${esc(t.title || new URL(t.url).hostname) || t.url}](<${t.url}>)`)
    .join("\n");
}

/** `content_md`: Markdown-Linkliste. `metadata` folgt dem Registry-Schema (nur url/title je Tab). */
export function buildSession(tabs: readonly TabInfo[], now = new Date(), windowName?: string): NoteRequest {
  const list = savableTabs(tabs);
  // no name given: what the tabs have in common, so the session is recognisable in Kortex and in the list
  const title = sessionTitle(list.length, now, windowName?.trim() || autoSessionName(list));
  return {
    kind: "note",
    client: clientInfo(EXTENSION_VERSION),
    captured_at: now.toISOString(),
    idempotency_key: newIdempotencyKey(),
    title,
    content_md: `# ${title}\n\n${markdownLinkList(list)}\n`,
    folder_path: SESSION_FOLDER,
    type_hint: "session",
    tags: ["session"],
    metadata: {
      saved_at: now.toISOString(),
      tabs: list.map((t) => ({ url: t.url!, ...(t.title ? { title: t.title.slice(0, 500) } : {}) })),
    },
  };
}

export type SaveSessionResult =
  | {
      ok: true;
      closed: number;
      saved: number;
      request: NoteRequest;
      itemId: string;
      /** Tabs, die trotz "schließen" offen blieben (angepinnt, schon weg, Browser blockiert gerade). */
      keptOpen?: number;
      /** Die geschlossenen Tabs, damit die Ansicht "Wiederherstellen" anbieten kann. */
      closedTabs?: { url: string }[];
    }
  | { ok: false; reason: "empty" | "queued" | "error"; message: string; request?: NoteRequest };

/**
 * Speichert und schließt erst bei `delivered` (Server hat geantwortet). Eingereiht (offline) oder Fehler
 * lassen alle Tabs offen; die Outbox liefert später nach.
 */
export async function saveSession(deps: {
  tabs: readonly TabInfo[];
  submit: (req: NoteRequest) => Promise<SubmitResult>;
  /** Schließt die Tabs und meldet die wirklich geschlossenen ids (ohne Liste: alle). */
  closeTabs: (ids: number[]) => Promise<number[] | void>;
  close: boolean;
  now?: Date;
  windowName?: string;
}): Promise<SaveSessionResult> {
  const list = savableTabs(deps.tabs);
  if (list.length === 0) return { ok: false, reason: "empty", message: t("No tabs that can be saved (http/https only).") };
  const request = buildSession(list, deps.now, deps.windowName);
  const res = await deps.submit(request);
  if (!res.ok) return { ok: false, reason: "error", message: res.error.message, request };
  if (!res.delivered) {
    return { ok: false, reason: "queued", message: deps.close
        ? t("Kortex is not answering right now ({reason}). Saving continues in the background, the tabs close afterwards.", { reason: res.reason })
        : t("Queued offline, will be delivered later ({reason}).", { reason: res.reason }), request };
  }
  // Nur eine bestätigte Antwort mit item_id zählt als gespeichert (neu, duplicate oder replayed); alles andere lässt die Tabs offen.
  const itemId = (res.response as { item_id?: unknown } | undefined)?.item_id;
  if (typeof itemId !== "string" || !itemId) {
    return { ok: false, reason: "error", message: t("Unexpected server answer, tabs stay open."), request };
  }
  // Mock mode saves nothing for real (item_id "mock-…"): never close tabs on that. Pinned tabs stay (Mail, Kalender).
  const closable = deps.close && !itemId.startsWith("mock-") ? list.filter((t) => t.id !== undefined && !t.pinned) : [];
  const ids = closable.map((t) => t.id!);
  let gone: number[] = [];
  if (ids.length) {
    // Gespeichert ist gespeichert: ein Fehler beim Schließen darf das Ergebnis nicht in "Fehler" drehen.
    gone = await deps.closeTabs(ids).then((r) => (Array.isArray(r) ? r : ids), () => []);
  }
  const closed = gone.length;
  const wanted = deps.close && !itemId.startsWith("mock-") ? list.length : 0;
  return {
    ok: true,
    closed,
    saved: list.length,
    request,
    itemId: res.response.item_id,
    ...(wanted > closed ? { keptOpen: wanted - closed } : {}),
    ...(closed ? { closedTabs: closable.filter((t) => gone.includes(t.id!)).map((t) => ({ url: t.url! })) } : {}),
  };
}
