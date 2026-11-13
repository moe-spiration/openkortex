/*
 * Client logic of the scratchpad drawer: wire types, optimistic list handling and key rules.
 * Framework-free so it is unit-tested (client.test.ts); the component only wires it to React.
 */

import { t } from "@/i18n";
import { weekdayShort } from "@/lib/date/words";

export interface PadEntry {
  id: string;
  at: string;
  text: string;
  /** Local only: shown before the server confirmed the entry. */
  pending?: boolean;
}

export type SuggestionAction = "note" | "task" | "object" | "discard" | "keep";

export interface PadSuggestion {
  entry_id: string;
  action: SuggestionAction;
  title?: string | null;
  target_item_id?: string | null;
  reason?: string | null;
}

export const SCRATCHPAD_EVENT = "kortex:scratchpad";
/** CustomEvent<number>: open entries after each load (the titlebar badge). */
export const SCRATCHPAD_COUNT_EVENT = "kortex:scratchpad-count";
/** CustomEvent<boolean>: the popover opened (true) or closed (false); the titlebar button shows its state. */
export const SCRATCHPAD_OPEN_EVENT = "kortex:scratchpad-open";
/** Detail of SCRATCHPAD_EVENT that toggles instead of opening (the titlebar button). */
export const SCRATCHPAD_TOGGLE = "toggle";
export const SCRATCHPAD_SHORTCUT_LABEL = "Alt+J";

/** An entry with a fenced code block is shown as code (mono, tinted), everything else as plain text. */
export const isCodeEntry = (text: string) => /^\s*```/m.test(text);

const two = (n: number) => String(n).padStart(2, "0");

/**
 * "Heute 08:40", "Gestern 22:05", "Di 19:12" (within a week) or "03.10.2026 19:12". The stamp of an entry is UTC
 * ("YYYY-MM-DD HH:MM", server/scratchpad/format.ts stamp()); shown in the local zone. Unknown formats pass through.
 */
export function padWhen(at: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(at);
  if (!m) return at;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!));
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `${t("Today")} ${time}`;
  if (diff === 1) return `${t("Yesterday")} ${time}`;
  if (diff > 1 && diff < 7) return `${weekdayShort(d.getDay())} ${time}`;
  return `${t("{month}/{day}/{year}", { day: two(d.getDate()), month: two(d.getMonth() + 1), year: d.getFullYear() })} ${time}`;
}

/** "Als Notiz anlegen" on one entry: the `note` decision (title = first line, server side). */
export const noteDecision = (entryId: string) => [{ entry_id: entryId, action: "note" as const }];

/** Alt+J (J = jot) opens the drawer; Alt alone keeps AltGr (Ctrl+Alt) typing safe. */
export function isScratchpadKey(e: Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">): boolean {
  return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === "KeyJ" || e.key.toLowerCase() === "j");
}

/** Ctrl/Cmd+Enter saves; plain Enter stays a newline (multi-line entries, code blocks). */
export const isSubmitKey = (e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">) =>
  e.key === "Enter" && (e.ctrlKey || e.metaKey);

export const pendingEntry = (text: string, now: Date, tmpId: string): PadEntry => ({
  id: tmpId,
  at: now.toISOString().slice(0, 16).replace("T", " "),
  text,
  pending: true,
});

/** Server list wins; entries still in flight stay at the end. */
export function mergeEntries(server: readonly PadEntry[], current: readonly PadEntry[]): PadEntry[] {
  return [...server, ...current.filter((e) => e.pending)];
}

export const dropPending = (list: readonly PadEntry[], tmpId: string) => list.filter((e) => e.id !== tmpId);

/** Optimistic delete: the entry leaves the list at once; on error the caller puts the old list back. */
export const withoutEntry = (list: readonly PadEntry[], id: string) => list.filter((e) => e.id !== id);

/** A single delete is the `discard` decision (no AI needed): the line leaves the pad and lands in the archive. */
export const deleteDecision = (entryId: string) => [{ entry_id: entryId, action: "discard" as const }];

/** Entries the "accept all" button applies (everything the model did not leave in the pad). */
export const acceptable = (s: readonly PadSuggestion[]) => s.filter((x) => x.action !== "keep");

export function toDecisions(s: readonly PadSuggestion[]) {
  return acceptable(s).map((x) => ({
    entry_id: x.entry_id,
    action: x.action as Exclude<SuggestionAction, "keep">,
    ...(x.title ? { title: x.title } : {}),
    ...(x.target_item_id ? { target_item_id: x.target_item_id } : {}),
  }));
}

export const ACTION_LABEL: Record<SuggestionAction, string> = {
  get note() {
    return t("As note");
  },
  get task() {
    return t("As task");
  },
  get object() {
    return t("Assign");
  },
  get discard() {
    return t("Discard");
  },
  get keep() {
    return t("Keep");
  },
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/scratchpad${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? t("Error {status}", { status: res.status }));
  return json as T;
}

export const loadPad = () => call<{ entries: PadEntry[] }>("");
export const addToPad = (text: string) => call<{ entries: PadEntry[] }>("", { text });
export const cleanupPad = () => call<{ entries: PadEntry[]; suggestions: PadSuggestion[] }>("/cleanup", {});
export const applyPad = (decisions: ReturnType<typeof toDecisions> | ReturnType<typeof deleteDecision>) =>
  call<{ entries: PadEntry[]; results: { entry_id: string; ok: boolean; error?: string }[] }>("/apply", { decisions });
