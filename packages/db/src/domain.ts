// Domain vocabulary shared by web, md-sync, mcp-server and ai-core.
// Type values mirror the CHECK constraint in supabase/migrations (test: type-registry.test.ts).
import { NEW_TYPED_TYPES, REGISTERED_TYPES, TYPE_REGISTRY, type RegisteredType } from "./type-registry";

// The type list lives in the type registry (type-registry.ts); only derived here.
export const KNOWLEDGE_ITEM_TYPES = REGISTERED_TYPES;
export type KnowledgeItemType = RegisteredType;

export const DOMAIN_OBJECT_TYPES = [
  "person",
  "project",
  "organization",
  "concept",
  "tool",
  "asset",
  "goal",
] as const;
export type DomainObjectType = (typeof DOMAIN_OBJECT_TYPES)[number];

export const isDomainObjectType = (type: string): type is DomainObjectType =>
  (DOMAIN_OBJECT_TYPES as readonly string[]).includes(type);

export const ITEM_STATUSES = ["inbox", "processing", "processed", "error", "archived"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ACTION_ITEM_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

// --- Per-type metadata (YAML frontmatter `metadata:` and the `metadata` JSONB) ---
// All fields are optional: objects are created from partial AI extraction or by hand.

export interface PersonMetadata {
  role?: string;
  organization?: string;
  relationship?: string;
  contact_info?: Record<string, string>;
}

export interface ProjectMetadata {
  project_status?: string;
  priority?: Priority;
  target_date?: string; // ISO date
  tech_stack?: string[];
  repo_or_url?: string;
}

export interface OrganizationMetadata {
  industry?: string;
  org_type?: string;
  location?: string;
  website?: string;
  key_contacts?: string[];
}

export interface ConceptMetadata {
  category?: string;
  maturity?: string;
  related_tools?: string[];
}

export interface ToolMetadata {
  tool_category?: string;
  usage_status?: string;
  pricing?: string;
  url?: string;
}

export interface AssetMetadata {
  asset_type?: string;
  location?: string;
  status?: string;
  monthly_value?: number;
}

export interface GoalMetadata {
  goal_timeframe?: string;
  target_metric?: string;
  progress_pct?: number; // 0-100
  status?: string;
}

export interface DomainObjectMetadataMap {
  person: PersonMetadata;
  project: ProjectMetadata;
  organization: OrganizationMetadata;
  concept: ConceptMetadata;
  tool: ToolMetadata;
  asset: AssetMetadata;
  goal: GoalMetadata;
}
export type DomainObjectMetadata<T extends DomainObjectType = DomainObjectType> =
  DomainObjectMetadataMap[T];

// --- Zero-setup vault folders (created by kortex.bootstrap_user()) ---

export const DOMAIN_OBJECT_FOLDERS = Object.fromEntries(
  DOMAIN_OBJECT_TYPES.map((t) => [t, TYPE_REGISTRY[t].folder]),
) as Record<DomainObjectType, string>;

/** Folders of the top-level tree and the fixed sub-folders, without the per-type folders. */
const BASE_FOLDERS = [
  "00_Inbox",
  "10_Notes",
  "10_Notes/Daily",
  "20_Meetings",
  "30_Clippings",
  "40_AI_Memories",
  "50_Recipes",
  "60_Documents",
  "70_Objects",
] as const;

export const SYSTEM_FOLDER_PATHS = [
  ...BASE_FOLDERS,
  ...Object.values(DOMAIN_OBJECT_FOLDERS),
  ...NEW_TYPED_TYPES.map((t) => TYPE_REGISTRY[t].folder),
  "90_Digests",
] as const;

/** Default vault folder per type (fallback of the auto-organizer). */
export const DEFAULT_FOLDER_BY_TYPE = Object.fromEntries(
  REGISTERED_TYPES.map((t) => [t, TYPE_REGISTRY[t].folder]),
) as Record<KnowledgeItemType, string>;

export const STORAGE_BUCKETS = {
  documents: "kortex-documents",
  media: "kortex-media",
  audio: "kortex-audio",
} as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/** Object keys must start with the owner's user id (enforced by storage RLS). */
export const storagePath = (userId: string, ...parts: string[]) => [userId, ...parts].join("/");
