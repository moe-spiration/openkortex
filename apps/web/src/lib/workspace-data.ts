import { cache } from "react";
import { getLocale, rememberLocale, setLocale, type Locale } from "@/i18n";
import type { TagDomain } from "@kortex/ui";
import { tagDomain } from "@kortex/ui";
import { HASHTAGS, NOTES as MOCK_NOTES, NOTE_TYPES, RECENT_NOTE_IDS as MOCK_RECENT } from "./mock/notes";
import { NOTE_CONTENT as MOCK_CONTENT } from "./mock/content";
import { OBJECT_ITEMS as MOCK_OBJECTS, type MockObject } from "./mock/objects";
import {
  ACTION_ITEMS as MOCK_TASKS,
  INBOX_REVIEW as MOCK_REVIEW,
  INBOX_TARGETS as MOCK_TARGETS,
  type ActionItem as TaskItem,
  type InboxProposal,
  type InboxTarget,
} from "./mock/views";
import { HEAT as MOCK_HEAT, JOURNAL_NOTE_IDS, JOURNAL_STREAK } from "./mock/journal";
import type {
  AutoSpace,
  InboxJob,
  KnowledgeItem,
  NoteContent,
  NoteSummary,
  ObjectHub,
  Profile,
  Tone,
  VaultFolder,
} from "./mock/types";
import {
  AUTO_SPACES as MOCK_SPACES,
  GARDENER_STATUS,
  INBOX_ACTIVE as MOCK_INBOX,
  LIFE_AREAS,
  LIVE_MEETING,
  MOCK_TODAY as MOCK_DAY,
  OBJECT_HUBS as MOCK_HUBS,
  PROFILE as MOCK_PROFILE,
  SIDEBAR_TAGS as MOCK_SIDEBAR_TAGS,
  VAULT_OPEN_DEFAULT as MOCK_OPEN,
  VAULT_ROOT,
  VAULT_TREE as MOCK_TREE,
} from "./mock/workspace";

/*
 * Data seam of the shell. Everything the shell renders comes through this module, with the same
 * exported names and shapes as the mock era, so components never change.
 *
 * Source (`KORTEX_DATA_SOURCE=mock|supabase`, default supabase when the Supabase keys are set):
 * - mock: the exports are the prototype data, as before.
 * - supabase: the exports are live views onto a `WorkspaceSnapshot` of the signed-in user
 *   (kortex.* via RLS, built in lib/supabase/snapshot.ts). On the server the snapshot is
 *   per request (React `cache`), filled by `await loadWorkspace()` in the route; in the browser
 *   it is installed once by <LiveData> in the workspace layout before any consumer renders.
 *   Arrays and records are Proxies, so `NOTES.filter(...)`, `[...NOTES]`, `PROFILE.name` read the
 *   current user's data on every access.
 *
 * Static UI config (nav, life areas, live-meeting HUD, gardener label) stays as is.
 */

export type * from "./mock/types";

/** Everything user-specific the shell reads. Serializable (crosses the server/client boundary). */
export interface WorkspaceSnapshot {
  source: "mock" | "supabase";
  userId: string | null;
  /** UI language from kortex.user_settings.locale; null: the browser's (mock mode, no row yet). */
  locale: Locale | null;
  /** Today in the user's time zone (YYYY-MM-DD). */
  today: string;
  profile: Profile;
  autoSpaces: AutoSpace[];
  objectHubs: ObjectHub[];
  vaultTree: VaultFolder[];
  vaultOpenDefault: Record<string, boolean>;
  sidebarTags: string[];
  /** Content items (no domain objects), newest first. */
  notes: KnowledgeItem[];
  /** Domain objects of 70_Objects, newest first. */
  objects: KnowledgeItem[];
  recentNoteIds: string[];
  inboxActive: InboxJob[];
  /** Today's daily note (10_Notes/Daily/<today>.md), if it exists. */
  dailyNoteId: string | null;
  /** All action items (with and without a source item), Tasks hub shape. */
  tasks: TaskItem[];
  /** Captures the Gardener placed on its own, waiting for the user's confirmation. */
  inboxReview: InboxProposal[];
  /** Folders a review item can be moved to ("Ziel ändern"). */
  inboxTargets: InboxTarget[];
  /** Daily notes (10_Notes/Daily), newest first. */
  dailyNotes: { id: string; date: string }[];
  /** Consecutive days with a daily note up to today. */
  streak: number;
  /** Captures per day of the last 12 weeks as 84 heat cells (percent, oldest first). */
  heat: number[];
}

/* ----------------------------------------------------------------------------------------------
 * Mode and snapshot resolution
 * -------------------------------------------------------------------------------------------- */

/** Inlined at build time by next.config.ts from KORTEX_DATA_SOURCE / the Supabase keys. */
const LIVE = process.env.NEXT_PUBLIC_KORTEX_DATA_SOURCE === "supabase";

const mockItems = (): KnowledgeItem[] =>
  MOCK_NOTES.map((n): KnowledgeItem => {
    const c = MOCK_CONTENT[n.id] ?? { contentMd: "", cover: null, actionItems: [] };
    return { ...n, ...c, metadata: {}, manualPlacement: false, folderSuggestion: null };
  });

const MOCK_SNAPSHOT: WorkspaceSnapshot = {
  source: "mock",
  userId: null,
  locale: null,
  today: MOCK_DAY,
  profile: MOCK_PROFILE,
  autoSpaces: MOCK_SPACES,
  objectHubs: MOCK_HUBS,
  vaultTree: MOCK_TREE,
  vaultOpenDefault: MOCK_OPEN,
  sidebarTags: MOCK_SIDEBAR_TAGS,
  notes: mockItems(),
  objects: MOCK_OBJECTS.map((o): KnowledgeItem => ({ ...o, manualPlacement: false, folderSuggestion: null })),
  recentNoteIds: MOCK_RECENT,
  inboxActive: MOCK_INBOX,
  dailyNoteId: null,
  tasks: MOCK_TASKS,
  inboxReview: MOCK_REVIEW,
  inboxTargets: MOCK_TARGETS,
  dailyNotes: JOURNAL_NOTE_IDS.map((id, i) => ({ id, date: i === 0 ? MOCK_DAY : "2026-10-21" })),
  streak: JOURNAL_STREAK,
  heat: MOCK_HEAT,
};

/** Today as YYYY-MM-DD in a time zone (sv-SE formats ISO-like). */
export function isoToday(timeZone = "Europe/Berlin", now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Live mode before the user's data arrived (or signed out): empty but well-formed. */
export function emptySnapshot(today = isoToday()): WorkspaceSnapshot {
  return {
    source: "supabase",
    userId: null,
    locale: null,
    today,
    profile: { name: "", initial: "", plan: "" },
    autoSpaces: MOCK_SPACES.map((s) => ({ ...s, count: 0 })),
    objectHubs: MOCK_HUBS.map((h) => ({ ...h, count: 0 })),
    vaultTree: [],
    vaultOpenDefault: {},
    sidebarTags: [],
    notes: [],
    objects: [],
    recentNoteIds: [],
    inboxActive: [],
    dailyNoteId: null,
    tasks: [],
    inboxReview: [],
    inboxTargets: [],
    dailyNotes: [],
    streak: 0,
    heat: Array.from({ length: 84 }, () => 0),
  };
}

const EMPTY_LIVE = emptySnapshot();

/** Per-request holder on the server (React `cache` is request-scoped in server components). */
const requestHolder = cache((): { snap: WorkspaceSnapshot | null } => ({ snap: null }));

let browserSnap: WorkspaceSnapshot | null = null;

function current(): WorkspaceSnapshot {
  if (!LIVE) return MOCK_SNAPSHOT;
  if (typeof window !== "undefined") return browserSnap ?? EMPTY_LIVE;
  return requestHolder().snap ?? EMPTY_LIVE;
}

/** Server: makes `snap` the data of the current request (called by lib/supabase/workspace.ts). */
export function setRequestSnapshot(snap: WorkspaceSnapshot): void {
  requestHolder().snap = snap;
  MOCK_TODAY = snap.today;
}

/** Browser: installs the signed-in user's snapshot (called by <LiveData> before children render). */
export function installSnapshot(snap: WorkspaceSnapshot): void {
  if (typeof window === "undefined") return;
  if (browserSnap === snap) return;
  browserSnap = snap;
  // The account's language wins over the browser's; the cookie tells the server for later requests.
  if (snap.locale && snap.locale !== getLocale()) {
    setLocale(snap.locale);
    rememberLocale(snap.locale);
  }
  MOCK_TODAY = snap.today;
  TOTAL_ENTRIES = snap.autoSpaces[0]?.count ?? 0;
  // Stores that copied items (the notes store) merge the new snapshot. Notified after the current
  // render (installSnapshot runs while <LiveData> renders), never during it.
  queueMicrotask(() => snapshotListeners.forEach((l) => l()));
}

const snapshotListeners = new Set<() => void>();

/**
 * Subscribe to newly installed snapshots (browser): after a capture or `router.refresh()` the
 * layout hands down a new one. For useSyncExternalStore together with `workspaceSnapshot`.
 */
export function subscribeSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

/** True when the workspace runs on the live database (writes should be persisted). */
export function isLiveData(): boolean {
  return current().source === "supabase";
}

/** The snapshot itself (for code that wants the whole picture, e.g. the notes store). */
export function workspaceSnapshot(): WorkspaceSnapshot {
  return current();
}

/* ----------------------------------------------------------------------------------------------
 * Live views (Proxies onto the current snapshot)
 * -------------------------------------------------------------------------------------------- */

function liveArray<T>(pick: (s: WorkspaceSnapshot) => readonly T[]): T[] {
  const arr = () => pick(current()) as T[];
  return new Proxy([] as T[], {
    get(_t, key) {
      const a = arr();
      const v = Reflect.get(a, key, a) as unknown;
      return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(a) : v;
    },
    has: (_t, key) => Reflect.has(arr(), key),
    ownKeys: () => Reflect.ownKeys(arr()),
    getOwnPropertyDescriptor: (_t, key) => Reflect.getOwnPropertyDescriptor(arr(), key),
    set: () => false,
  });
}

function liveRecord<T extends object>(pick: (s: WorkspaceSnapshot) => T): T {
  const obj = () => pick(current());
  return new Proxy({} as T, {
    get: (_t, key) => Reflect.get(obj(), key),
    has: (_t, key) => Reflect.has(obj(), key),
    ownKeys: () => Reflect.ownKeys(obj()),
    getOwnPropertyDescriptor: (_t, key) => {
      const d = Reflect.getOwnPropertyDescriptor(obj(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
    set: () => false,
  });
}

/** Derived lookups, computed once per snapshot. */
interface Derived {
  all: NoteSummary[];
  byId: Map<string, NoteSummary>;
  content: Record<string, NoteContent>;
}
const derivedCache = new WeakMap<WorkspaceSnapshot, Derived>();
function derived(s: WorkspaceSnapshot = current()): Derived {
  let d = derivedCache.get(s);
  if (!d) {
    const all: NoteSummary[] = [...s.notes, ...s.objects];
    d = {
      all,
      byId: new Map(all.map((n) => [n.id, n])),
      content: Object.fromEntries(
        s.notes.map((n) => [n.id, { contentMd: n.contentMd, cover: n.cover, actionItems: n.actionItems, reader: n.reader }]),
      ),
    };
    derivedCache.set(s, d);
  }
  return d;
}

export const NOTES: NoteSummary[] = liveArray((s) => s.notes);
export const OBJECT_ITEMS: MockObject[] = liveArray((s) => s.objects);
/** Notes plus the domain objects in 70_Objects (everything a [[link]] can point to). */
export const ALL_ITEMS: NoteSummary[] = liveArray((s) => derived(s).all);
export const NOTE_CONTENT: Record<string, NoteContent> = liveRecord((s) => derived(s).content);
export const RECENT_NOTE_IDS: string[] = liveArray((s) => s.recentNoteIds);
export const AUTO_SPACES: AutoSpace[] = liveArray((s) => s.autoSpaces);
export const OBJECT_HUBS: ObjectHub[] = liveArray((s) => s.objectHubs);
export const VAULT_TREE: VaultFolder[] = liveArray((s) => s.vaultTree);
export const VAULT_OPEN_DEFAULT: Record<string, boolean> = liveRecord((s) => s.vaultOpenDefault);
export const SIDEBAR_TAGS: string[] = liveArray((s) => s.sidebarTags);
export const INBOX_ACTIVE: InboxJob[] = liveArray((s) => s.inboxActive);
export const PROFILE: Profile = liveRecord((s) => s.profile);
/** Tasks hub: all action items (mock: the prototype task list). */
export const TASKS: TaskItem[] = liveArray((s) => s.tasks);
/** Inbox review queue (mock: the prototype proposals). */
export const INBOX_PROPOSALS: InboxProposal[] = liveArray((s) => s.inboxReview);
/** Folders offered as review targets. */
export const INBOX_TARGET_FOLDERS: InboxTarget[] = liveArray((s) => s.inboxTargets);
/** Daily notes, newest first. */
export const DAILY_NOTES: { id: string; date: string }[] = liveArray((s) => s.dailyNotes);
/** Journal heat map cells (84, oldest first). */
export const JOURNAL_HEAT: number[] = liveArray((s) => s.heat);

/** Consecutive days with a daily note up to today. */
export function dailyStreakNow(): number {
  return current().streak;
}

/**
 * "Today" for date labels. Mock: the prototype's frozen Thursday; live: the real day. A `let`
 * export (ESM live binding), refreshed whenever a snapshot is installed.
 */
export let MOCK_TODAY: string = LIVE ? isoToday() : MOCK_DAY;

/** Total entries in the vault (the Auto-Spaces group meta). Live binding like MOCK_TODAY. */
export let TOTAL_ENTRIES: number = LIVE ? 0 : (MOCK_SPACES[0]?.count ?? 0);

// Static UI configuration (identical in both modes).
export { GARDENER_STATUS, LIFE_AREAS, LIVE_MEETING, NOTE_TYPES, VAULT_ROOT };

export function noteById(id: string): NoteSummary | undefined {
  return derived().byId.get(id);
}

/** Colour domain of a hashtag: the prototype's explicit mapping first, then the generic rule. */
export function tagTone(label: string): TagDomain {
  return HASHTAGS.find((t) => t.label === label)?.tone ?? tagDomain(label);
}

/** `.kx-pill` modifier class for a hashtag (ai is the default pill colour). */
export function pillClass(label: string): string {
  const tone = tagTone(label);
  return tone === "ai" ? "" : `kx-pill--${tone}`;
}

/**
 * Full knowledge items for the note page (knowledge_items + action_items): content items first,
 * then the domain objects. Fresh copies, so the notes store can own them.
 */
export function initialKnowledgeItems(): KnowledgeItem[] {
  const s = current();
  return [...s.notes, ...s.objects].map((i) => ({ ...i }));
}

/** CSS colours of a type tone (hashtag domain or check-in teal). */
export function toneVars(tone: Tone): { bg: string; fg: string; dot: string; border: string } {
  if (tone === "checkin")
    return {
      bg: "color-mix(in srgb, var(--accent-checkin) 12%, transparent)",
      fg: "var(--accent-checkin)",
      dot: "var(--accent-checkin)",
      border: "color-mix(in srgb, var(--accent-checkin) 25%, transparent)",
    };
  return { bg: `var(--tag-${tone}-bg)`, fg: `var(--tag-${tone}-fg)`, dot: `var(--tag-${tone}-dot)`, border: `var(--tag-${tone}-border)` };
}
