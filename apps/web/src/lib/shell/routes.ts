import { t, tx } from "@/i18n";
import type { IconId } from "@/components/shell/icons";
import { findSpace } from "@/lib/spaces";
import { AUTO_SPACES, LIFE_AREAS, NOTE_TYPES, OBJECT_HUBS, noteById, NOTES } from "@/lib/workspace-data";

/*
 * Route model of the workspace. Every view of the prototype maps to an App Router path;
 * tabs, the active sidebar row and the copilot context label all derive from it.
 */

export type ViewId =
  | "home"
  | "journal"
  | "inbox"
  | "agent"
  | "tasks"
  | "reminders"
  | "flashcards"
  | "graph"
  | "insights"
  | "review"
  | "life"
  | "settings"
  | "spaces"
  | "objects"
  | "hashtags"
  | "favorites"
  | "archive"
  | "vault"
  | "notes"
  | "reader";

export interface RouteInfo {
  view: ViewId;
  /** Tab identity: one tab per key (all spaces share one tab, every vault file gets its own). */
  tabKey: string;
  tabLabel: string;
  tabIcon: IconId;
  /** Documents (notes, reader, vault files) get a tab; navigation views don't (V2-03b). */
  doc: boolean;
  /** Label for the copilot context ("Hybrid-RAG Copilot · <label>"). */
  title: string;
  /** Path segments after the view, already decoded. */
  rest: string[];
}

/** Labels and titles are functions: read in the language of the moment `routeInfo` runs. */
const FIXED: Partial<Record<ViewId, { label: () => string; icon: IconId; title?: () => string }>> = {
  home: { label: () => tx("nav", "Today"), icon: "home" },
  // fx3: day and week tab of one view (/journal, /journal/week); the old /review redirects to the week tab.
  journal: { label: () => t("Journal"), icon: "sun" },
  inbox: { label: () => "Inbox", icon: "inbox" },
  agent: { label: () => "Agent", icon: "sparkles" },
  tasks: { label: () => tx("nav", "Tasks"), icon: "todo" },
  reminders: { label: () => t("Reminders"), icon: "bell" },
  flashcards: { label: () => t("Flashcards"), icon: "cards" },
  graph: { label: () => "Graph", icon: "graph", title: () => t("Knowledge graph") },
  insights: { label: () => "Insights", icon: "chart" },
  review: { label: () => t("Journal"), icon: "review", title: () => tx("title", "Weekly review") },
  life: { label: () => "Life", icon: "life" },
  settings: { label: () => t("Settings"), icon: "gear" },
  hashtags: { label: () => "Hashtags", icon: "hash" },
  // G4 (feedback round 3): own categories for starred and archived items.
  favorites: { label: () => t("Favorites"), icon: "star" },
  archive: { label: () => t("Archive"), icon: "archive" },
};

/** Reader tab labels per item (prototype: "AI_Engineering.pdf [S. 42]"). */
const READER_LABELS: Record<string, string> = { n3: "AI_Engineering.pdf [S. 42]" };

export const readerHref = (id: string) => `/reader/${id}`;
export const READER_HREF = readerHref("n3");
export const noteHrefById = (id: string) => `/notes/${id}`;

function decode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export function routeInfo(pathname: string): RouteInfo {
  const segs = pathname.split("/").filter(Boolean).map(decode);
  const head = (segs[0] ?? "home") as ViewId;
  const rest = segs.slice(1);
  const fixed = FIXED[head];
  if (fixed) {
    const area = head === "life" ? LIFE_AREAS.find((a) => a.key === rest[0]) : undefined;
    const week = head === "journal" && rest[0] === "week" ? tx("title", "Weekly review") : undefined;
    return { view: head, tabKey: head, tabLabel: fixed.label(), tabIcon: fixed.icon, doc: false, title: area?.label ?? week ?? fixed.title?.() ?? fixed.label(), rest };
  }
  if (head === "spaces") {
    const space = findSpace(AUTO_SPACES, rest[0]) ?? AUTO_SPACES[0]!;
    return { view: "spaces", tabKey: "spaces", tabLabel: "Spaces", tabIcon: "grid", doc: false, title: space.label, rest };
  }
  if (head === "objects") {
    const hub = OBJECT_HUBS.find((h) => h.type === rest[0]);
    const label = hub?.label ?? t("Objects");
    return { view: "objects", tabKey: `objects:${rest[0] ?? ""}`, tabLabel: label, tabIcon: "folder", doc: false, title: label, rest };
  }
  if (head === "notes" && rest[0] === "new") {
    // Tactile Craft: the new-note editor (openNewNote in ./store.tsx) is a document with its own tab.
    return { view: "notes", tabKey: NEW_NOTE_TAB_KEY, tabLabel: t("Untitled"), tabIcon: "file-plus", doc: true, title: t("New note"), rest };
  }
  if (head === "notes" || head === "reader") {
    const id = rest[0] ?? "";
    const note = noteById(id);
    if (head === "reader") {
      const label = READER_LABELS[id] ?? (note ? note.title + " (Reader)" : "Reader");
      return { view: "reader", tabKey: `reader:${id}`, tabLabel: label, tabIcon: "i-book", doc: true, title: note?.title ?? label, rest };
    }
    const label = note?.title ?? t("Note");
    return { view: "notes", tabKey: `note:${id}`, tabLabel: label, tabIcon: note ? NOTE_TYPES[note.type].icon : "i-note", doc: true, title: label, rest };
  }
  if (head === "vault") {
    const path = rest.join("/");
    const isFile = /\.(md|pdf|epub)$/i.test(path);
    const note = NOTES.find((n) => n.path === path);
    const label = note?.title ?? rest[rest.length - 1] ?? "Vault";
    const icon: IconId = note ? NOTE_TYPES[note.type].icon : isFile ? "i-note" : "folder";
    return { view: "vault", tabKey: `vault:${path}`, tabLabel: label, tabIcon: icon, doc: isFile, title: label, rest };
  }
  return { view: "home", tabKey: "home", tabLabel: "Home", tabIcon: "home", doc: false, title: "Home", rest: [] };
}

/** Tab of the new-note editor (/notes/new). */
export const NEW_NOTE_TAB_KEY = "note:new";

/** The Home tab is pinned first and icon-only; every other tab is a document. */
export const HOME_TAB_KEY = "home";

/** Tab keys that stay in the strip: Home plus documents (notes, reader, vault files). Used to migrate stored tabs. */
export function isDocTabKey(key: string): boolean {
  if (key.startsWith("note:") || key.startsWith("reader:")) return true;
  return key.startsWith("vault:") && /\.(md|pdf|epub)$/i.test(key);
}

export const spaceHref = (key: string, tag?: string | null) =>
  `/spaces/${key}` + (tag ? `?tag=${encodeURIComponent(tag)}` : "");
export const vaultHref = (path: string) => "/vault/" + path.split("/").map(encodeURIComponent).join("/");
export const objectHref = (type: string) => `/objects/${type}`;
export const lifeHref = (key: string) => `/life/${key}`;

export function noteHref(id: string): string | null {
  return noteById(id) ? noteHrefById(id) : null;
}
