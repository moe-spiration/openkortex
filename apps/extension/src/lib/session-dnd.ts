// Drag & Drop im Tab-Manager (Toby-Stil, dnd-kit). Jedes ziehbare oder ablegbare Element trägt eine kleine
// Beschreibung (`DndData`); `resolveDrop` macht daraus rein und testbar die eine Änderung, die der Drop bedeutet.
import { t } from "../i18n";
import { moveTabBetween, reorderKeys, sessionKey, type SavedSession } from "./library";
import { cardTitle } from "./session-view";
import type { TabInfo } from "./sessions";

export type OpenTab = Pick<TabInfo, "url" | "title" | "favIconUrl">;

export type DndData =
  /** eine gespeicherte Session (Griff am Kopf) */
  | { kind: "session"; sessionKey: string }
  /** ein Tab in einer gespeicherten Session */
  | { kind: "tab"; sessionKey: string; index: number }
  /** ein offener Browser-Tab */
  | { kind: "open"; tab: OpenTab }
  /** die Fläche einer Session (auch leer oder eingeklappt): anhängen */
  | { kind: "container"; sessionKey: string }
  /** "Neue Session": der Drop legt eine Session mit diesem Tab an */
  | { kind: "new" };

export type DropAction =
  | { type: "reorder"; keys: string[] }
  | { type: "edit"; sessions: SavedSession[]; message: string }
  | { type: "add-open"; tabs: OpenTab[]; sessionKey: string; index?: number }
  | { type: "new-session"; tabs: OpenTab[] }
  | { type: "noop"; message?: string };

/** Stabile, eindeutige id eines Tabs in einer Session (gleiche URL zweimal: Zähler). */
export function tabDndId(key: string, tabs: readonly { url: string }[], index: number): string {
  const url = tabs[index]?.url ?? "";
  let n = 0;
  for (let i = 0; i < index; i++) if (tabs[i]!.url === url) n++;
  return `t␟${key}␟${url}␟${n}`;
}
export const sessionDndId = (key: string) => `s␟${key}`;
export const containerDndId = (key: string) => `c␟${key}`;
export const openDndId = (tabId: number) => `o␟${tabId}`;
export const NEW_SESSION_ID = "new-session";

const movedMessage = (same: boolean, name: string | null) =>
  same ? t("Tab moved") : name ? t("Tab moved to “{name}”", { name }) : t("Tab moved to the session");

/** Die Session, auf die ein Ziel zeigt (Tab, Fläche oder Kopf). */
const targetKey = (over: DndData) => ("sessionKey" in over ? over.sessionKey : null);

/**
 * Was ein Drop bedeutet. `active` ist das gezogene Element, `over` das Ziel unter dem Zeiger (oder null).
 * Tabs innerhalb einer Session landen dort, wo das Ziel stand (wie beim Sortieren in Toby); in einer anderen Session
 * vor dem Ziel-Tab, auf der Fläche hinten angehängt.
 */
export function resolveDrop(active: DndData | null | undefined, over: DndData | null | undefined, sessions: readonly SavedSession[]): DropAction | null {
  if (!active || !over) return null;
  const keys = sessions.map(sessionKey);
  const name = (key: string) => {
    const s = sessions.find((x) => sessionKey(x) === key);
    return s ? cardTitle(s) : null;
  };

  if (active.kind === "session") {
    const to = targetKey(over);
    if (!to || to === active.sessionKey) return null;
    const next = reorderKeys(keys, active.sessionKey, to);
    return next.join("\n") === keys.join("\n") ? null : { type: "reorder", keys: next };
  }

  if (active.kind === "tab") {
    const to = targetKey(over);
    if (!to || over.kind === "session" && to === active.sessionKey) return null;
    let index: number | undefined;
    if (over.kind === "tab") {
      // dieselbe Session: das Ziel nimmt den Platz ein (arrayMove); moveTabBetween will die Position vor dem Entfernen
      index = to === active.sessionKey && over.index > active.index ? over.index + 1 : over.index;
    }
    const edited = moveTabBetween(sessions, { sessionKey: active.sessionKey, index: active.index }, { sessionKey: to, index });
    if (!edited) return null;
    return { type: "edit", sessions: edited, message: movedMessage(to === active.sessionKey, name(to)) };
  }

  if (active.kind === "open") {
    if (over.kind === "new") return { type: "new-session", tabs: [active.tab] };
    const to = targetKey(over);
    if (!to) return null;
    return { type: "add-open", tabs: [active.tab], sessionKey: to, ...(over.kind === "tab" ? { index: over.index } : {}) };
  }
  return null;
}
