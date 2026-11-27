import type { DomainObjectType } from "@kortex/db/domain";
import type { ObjectType, TagDomain } from "@kortex/ui";
import type { IconId } from "@/components/shell/icons";

/*
 * Shapes the shell renders. Etappe 2 maps @kortex/db rows (knowledge_items, folders, tags,
 * action_items) onto these, so components never touch the mock modules directly.
 */

export type NoteType = "note" | "meeting" | "article" | "book" | "video" | "podcast" | "ai" | "recipe";
/** Type of a knowledge item in the shell: a content type or one of the 7 domain objects. */
export type ItemType = NoteType | DomainObjectType;
/** Colour tone of a type: a hashtag domain or the check-in teal (tools). */
export type Tone = TagDomain | "checkin";

export interface NoteTypeMeta {
  label: string;
  icon: IconId;
  tone: Tone;
}

export interface Hashtag {
  label: string; // with leading '#'
  tone: TagDomain;
}

export interface NoteSummary {
  id: string;
  type: ItemType;
  /** Live only: the registry type (knowledge_items.type) behind the shell type, e.g. "movie" for a video. */
  dbType?: string;
  title: string;
  /** Vault path, e.g. "20_Meetings/Automotive/2026-10-22_Q4-Architektur-Sync.md". */
  path: string;
  date: string; // ISO day
  time: string; // HH:mm
  tags: string[];
  tldr: string;
  /** Linked note ids (backlinks). */
  links: string[];
}

export interface NavItem {
  id: string;
  label: string;
  icon: IconId;
  href: string;
  /** Static badge text; the inbox badge is computed from live counts instead. */
  badge?: string;
}

export interface LifeArea {
  key: string;
  label: string;
  icon: IconId;
  tone: TagDomain;
  /** Balance score in percent; null for the "all areas" row. */
  score: number | null;
}

export interface AutoSpace {
  key: string;
  label: string;
  /** Prototype glyph of a curated space. */
  icon: IconId;
  /** Lucide name from the type registry (spaces derived from it, lib/spaces.ts); wins over `icon`. */
  lucide?: string;
  count: number;
  /** Registry types (knowledge_items.type) the space collects; null = everything. */
  types: readonly string[] | null;
  /** Type hint for captures while the space is open (spaces that collect several types). */
  hint?: string;
}

export interface ObjectHub {
  type: Exclude<ObjectType, "note">;
  label: string;
  /** Folder below 70_Objects/. */
  folder: string;
  count: number;
}

export interface VaultFolder {
  id: string;
  name: string;
  /** Path relative to the vault root. */
  path: string;
  depth: number;
  parent?: string;
  hasChildren?: boolean;
}

export interface InboxJob {
  /** knowledge_items.id (live, and captures once the server accepted them): the row opens and can be deleted. */
  itemId?: string | null;
  title: string;
  icon: IconId;
  step: string;
  pct: number;
}

export interface Profile {
  name: string;
  initial: string;
  plan: string;
}

export interface MeetingPerson {
  name: string;
  initial: string;
  tone?: TagDomain;
}

export interface LiveMeeting {
  title: string;
  clock: string;
  people: MeetingPerson[];
  coaching: string;
  noteId: string;
}

export interface ActionItem {
  id: string;
  text: string;
  done: boolean;
  /** Recording timestamp (mm:ss) for meeting items: the jump target. */
  timestamp?: string;
}

/** Body of a knowledge item (content_md and its satellites). */
export interface NoteContent {
  contentMd: string;
  /** Cover image URL; null renders the generated pattern in the type colour. */
  cover: string | null;
  actionItems: ActionItem[];
  /** Has a PDF/EPUB source that opens in the split reader. */
  reader?: boolean;
}

/** Full knowledge item as the note page edits it (knowledge_items row + action_items). */
export interface KnowledgeItem extends NoteSummary, NoteContent {
  /** Type-specific properties (the metadata JSONB / YAML frontmatter). */
  metadata: Record<string, unknown>;
  /** User placed it by hand: the organizer never moves it (CLAUDE.md rule 3). */
  manualPlacement: boolean;
  /** Folder the item should move to after a type change, until accepted or dismissed. */
  folderSuggestion: string | null;
  /** Live only: pipeline status (inbox/processing = still being captured, error = failed). */
  status?: "inbox" | "processing" | "processed" | "error" | "archived";
  /** Live only: where the item came from (source_url, the stored original file). */
  source?: ItemSource;
  /** Live only: knowledge_items.updated_at (ISO). */
  updatedAt?: string;
  /**
   * Live only: the body was left out of the workspace snapshot (older items, to keep the payload small); `contentMd`
   * is "" until the notes store loads it (`loadBody`). Nothing may save the body of an item while this is set.
   */
  bodyPending?: true;
  /** Live only: knowledge_items.reading_state of PDF/EPUB items (shape owned by the reader). */
  readingState?: Record<string, unknown> | null;
  /** Page icon (knowledge_items.icon): a Lucide icon name, e.g. "book-open" (W4). null = the type glyph. */
  icon?: string | null;
  /** Marked as favorite (knowledge_items.is_favorite, G4). */
  favorite?: boolean;
  /** Reminder / snooze instant (knowledge_items.remind_at, ISO); due once it passes. */
  remindAt?: string | null;
  /** Delta radar state of a URL item (metadata.watch). */
  watch?: import("@/lib/radar").WatchState | null;
  /** Live only: the organizer's placement (metadata.placement: confidence, review flag). */
  placement?: import("@/lib/placement").PlacementMeta | null;
}

/** Original of a captured item (live data). */
export interface ItemSource {
  url: string | null;
  /** Stored original in Supabase Storage (bucket kortex-documents unless the path names one). */
  file?: { path: string; mime: string | null; format: "pdf" | "epub" | "other"; sizeBytes: number | null };
  /** PDF page count from the ingest pipeline (metadata.page_count). */
  pageCount?: number | null;
  /** Original file name (metadata.original_file_name). */
  fileName?: string | null;
}

/** Badge kind: plain note or a domain object. */
export type ObjectKind = Extract<ObjectType, "note"> | DomainObjectType;
