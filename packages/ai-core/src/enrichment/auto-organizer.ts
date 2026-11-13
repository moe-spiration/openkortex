import { ph, type ContentPhraseKey } from "../i18n";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  matchKey,
  DEFAULT_FOLDER_BY_TYPE,
  DOMAIN_OBJECT_FOLDERS,
  DOMAIN_OBJECT_TYPES,
  isDomainObjectType,
  normalizeTimeframe,
  PRIORITIES,
  SYSTEM_FOLDER_PATHS,
  type DomainObjectType,
  type KnowledgeItemType,
  type Priority,
} from "@kortex/db";
import type { SummaryLevel } from "../adapters/base-adapter";
import { TYPED_EXTRACTION_TYPES, type TypedExtractionType } from "../typed/extraction";
import { renderOrganizerPrompt, renderOrganizerUserMessage } from "../prompts/organizer";

// --- Schema (spec 04, section 5.1) -------------------------------------------------

export const ENTITY_TYPES = [...DOMAIN_OBJECT_TYPES, "other"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const EnrichmentActionItemSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  assignee: z.string(),
  priority: z.enum(PRIORITIES),
  due_date: z.string().nullable(),
  source_timestamp_sec: z.number().nullable(),
  /** Title of an existing project / goal object this task belongs to (matched in normalizeActionItems). */
  project: z.string().nullish(),
  /** "today" | "this_week" | "later" | YYYY-MM-DD. */
  timeframe: z.string().nullish(),
  /** One short sentence: why / where from. */
  context: z.string().nullish(),
});

/** What the model must return. Post-processing (normalizeEnrichment) enforces the hard rules. */
export const EnrichmentSchema = z.object({
  title: z.string(),
  summary: z.string(),
  /** 3-7 key points for articles and documents; empty for other types. */
  key_points: z.array(z.string()).nullish(),
  cluster_name: z.string().nullable(),
  suggested_folder_path: z.string().nullable(),
  /** 0..1: how sure the model is that folder, tags and type fit (zero-setup auto-placement). */
  placement_confidence: z.number().min(0).max(1).nullish(),
  tags: z.array(z.string()),
  entities: z.array(z.object({ name: z.string(), type: z.enum(ENTITY_TYPES) })),
  action_items: z.array(EnrichmentActionItemSchema),
  /** 0..1: how sure the model is about "suggested_type" alone (independent of the folder). */
  type_confidence: z.number().min(0).max(1).nullish(),
  /** Typed item type the content really is (movie, book, product, …); null = keep the type. */
  suggested_type: z.enum(TYPED_EXTRACTION_TYPES).nullish(),
  /** Books and tools named in a video or podcast, linked as [[Wiki-Links]]. */
  mentions: z.array(z.object({ name: z.string(), kind: z.enum(["book", "tool"]) })).nullish(),
});
export type Enrichment = z.infer<typeof EnrichmentSchema>;

// --- Inputs / outputs ------------------------------------------------------------------

export interface ExistingObject {
  id: string;
  title: string;
  type: DomainObjectType;
  aliases?: string[];
  /** E-mail addresses of a person (metadata.email / metadata.contact_info.email), lowercase. */
  emails?: string[];
}

export interface OrganizerContext {
  existingTags: readonly string[];
  existingClusters: readonly string[];
  existingObjects: readonly ExistingObject[];
  /** Known folder paths (system + user folders) the item may be placed in. */
  folderPaths?: readonly string[];
  /**
   * Routing part of the agents guide (agents.md), so the organizer files items by the same rules
   * as external agents (feedback G6b). Callers build it with `routingGuideFromAgentsGuide` from
   * `renderAgentsGuide()` (@kortex/mcp-server). ai-core does not import mcp-server, because
   * mcp-server depends on ai-core. Omitted: the prompt is unchanged.
   */
  routingGuide?: string;
}

export interface OrganizeInput {
  type: KnowledgeItemType;
  sourcePlatform: string;
  contentMd: string;
  titleHint?: string;
  sourceUrl?: string;
  /** Headings of structural chunks (chapters/pages), sent as outline. */
  outline?: readonly string[];
  /** `is_manual_placement`: folder and cluster stay untouched. */
  isManualPlacement: boolean;
  manualTags?: readonly string[];
  /** user_settings.auto_tag_enabled (default true). */
  autoTagEnabled?: boolean;
  /** user_settings.auto_cluster_enabled (default true). */
  autoClusterEnabled?: boolean;
  /** Summary length (clipper setting); default "concise". */
  summaryLevel?: SummaryLevel;
}

export interface LinkedEntity {
  name: string;
  type: EntityType;
  objectId: string;
  objectType: DomainObjectType;
}

export interface SuggestedObject {
  name: string;
  type: DomainObjectType;
}

export interface EnrichmentActionItem {
  title: string;
  description: string | null;
  assignee: string;
  priority: Priority;
  due_date: string | null;
  source_timestamp_sec: number | null;
  /** knowledge_items.id of the matched project / goal object, null when none matched. */
  project_item_id: string | null;
  /** Canonical title of that object (for markdown output); null with project_item_id. */
  project_title: string | null;
  timeframe: string | null;
  context: string | null;
}

export interface OrganizerResult {
  title: string;
  summary: string | null;
  /** Key points (only for articles, PDFs, EPUBs), stored as metadata.key_points + "## Kernpunkte". */
  keyPoints: string[];
  /** null = do not touch (manual placement or auto-cluster off). */
  clusterName: string | null;
  /** null = do not touch (manual placement). */
  folderPath: string | null;
  /**
   * 0..1, how sure the organizer is about folder + tags + type. null = manual placement or the
   * model gave none. The web app applies placements at or above the user's threshold silently and
   * only asks for confirmation below it. Capped when the suggested folder was unusable, 0 when the
   * model call failed (fallback enrichment).
   */
  placementConfidence: number | null;
  tags: string[];
  /** All entity names (knowledge_items.entities). */
  entities: string[];
  linkedEntities: LinkedEntity[];
  /** Entities of a domain type with no matching object yet ("Turn into object" candidates). */
  suggestedObjects: SuggestedObject[];
  actionItems: EnrichmentActionItem[];
  /**
   * Typed type the content belongs to (only for generic notes/pages/bookmarks, only when the
   * placement confidence is at least TYPE_SUGGESTION_MIN_CONFIDENCE). `ingest()` then runs the
   * typed extraction.
   */
  suggestedType: TypedExtractionType | null;
  /** Books/tools mentioned in videos and podcasts, canonical spelling where an object exists. */
  mentions: Mention[];
}

export interface Mention {
  name: string;
  kind: "book" | "tool";
}

export interface OrganizeOptions {
  model: LanguageModel;
  /** Characters of content sent to the model. Default 24k (~6k tokens). */
  maxContentChars?: number;
  abortSignal?: AbortSignal;
}

// --- Defaults ------------------------------------------------------------------------

const MAX_TITLE = 80;
const MAX_AI_TAGS = 5;

/** Default vault folder per item type (from the type registry), used when the model's suggestion is unusable. */
export { DEFAULT_FOLDER_BY_TYPE };

// --- Normalisation helpers --------------------------------------------------------------

// matchKey lives in @kortex/db (dedup.ts) so every entry point shares it.
export { matchKey };

/** "AI / MCP Server " → "ai/mcp-server". Max 3 levels. */
export function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/^#/, "")
    .split("/")
    .map((p) =>
      p
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\p{L}\p{N}_-]/gu, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter(Boolean)
    .slice(0, 3)
    .join("/");
}

function dedupe(values: Iterable<string>, key: (s: string) => string = (s) => s): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = key(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Manual tags first, then up to 5 AI tags, snapped to existing tags to avoid sprawl. */
export function resolveTags(
  aiTags: readonly string[],
  manualTags: readonly string[],
  existing: readonly string[],
  autoTag: boolean,
): string[] {
  const byKey = new Map(existing.map((t) => [matchKey(t), t]));
  const snap = (t: string) => {
    const n = normalizeTag(t);
    return byKey.get(matchKey(n)) ?? n;
  };
  const manual = manualTags.map(snap).filter(Boolean);
  const ai = autoTag
    ? dedupe(aiTags.map(snap).filter(Boolean), matchKey).slice(0, MAX_AI_TAGS)
    : [];
  return dedupe([...manual, ...ai], matchKey);
}

export function resolveCluster(
  suggested: string | null,
  existing: readonly string[],
): string | null {
  const s = suggested?.trim();
  if (!s) return null;
  return existing.find((c) => matchKey(c) === matchKey(s)) ?? s.slice(0, 80);
}

/** Accepts the model's folder only if it is a known folder (or under one); else the type default. */
export function resolveFolderPath(
  suggested: string | null,
  type: KnowledgeItemType,
  known: readonly string[] = [],
): string {
  const fallback = DEFAULT_FOLDER_BY_TYPE[type];
  // Domain objects always live in their type folder (70_Objects/People, …); the model sometimes
  // invents a translated one ("70_Objects/Personen").
  if (isDomainObjectType(type)) return DOMAIN_OBJECT_FOLDERS[type];
  const s = suggested
    ?.trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  if (!s) return fallback;
  const all = [...SYSTEM_FOLDER_PATHS, ...known];
  const exact = all.find((p) => p.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  // A new sub-folder below an existing folder is fine (e.g. "10_Notes/Automotive").
  if (all.some((p) => s.toLowerCase().startsWith(`${p.toLowerCase()}/`))) return s;
  return fallback;
}

export function linkEntities(
  entities: Enrichment["entities"],
  objects: readonly ExistingObject[],
): { names: string[]; linked: LinkedEntity[]; suggested: SuggestedObject[] } {
  const index = new Map<string, ExistingObject>();
  for (const o of objects) {
    for (const name of [o.title, ...(o.aliases ?? [])]) {
      const k = matchKey(name);
      if (k && !index.has(k)) index.set(k, o);
    }
  }
  const seen = new Set<string>();
  const linked: LinkedEntity[] = [];
  const suggested: SuggestedObject[] = [];
  const names: string[] = [];
  for (const e of entities) {
    const name = e.name.trim();
    const obj = index.get(matchKey(name));
    // Two spellings of one object, or the same name twice, count once.
    const key = obj ? `obj:${obj.id}` : `name:${matchKey(name)}`;
    if (!matchKey(name) || seen.has(key)) continue;
    seen.add(key);
    if (obj) {
      names.push(obj.title); // canonical spelling of the object
      linked.push({ name: obj.title, type: e.type, objectId: obj.id, objectType: obj.type });
    } else {
      names.push(name);
      if (e.type !== "other") suggested.push({ name, type: e.type });
    }
  }
  return { names, linked, suggested };
}

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));

const MAX_CONTEXT = 300;

/** Project / goal objects a task may link to; the model names one, we match by title or alias. */
function projectIndex(objects: readonly ExistingObject[]): Map<string, ExistingObject> {
  const index = new Map<string, ExistingObject>();
  for (const o of objects) {
    if (o.type !== "project" && o.type !== "goal") continue;
    for (const name of [o.title, ...(o.aliases ?? [])]) {
      const k = matchKey(name);
      if (k && !index.has(k)) index.set(k, o);
    }
  }
  return index;
}

const wordsOf = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/**
 * Tasks an adapter extracted itself (meeting, voice) carry no project link. Without another model
 * call: a task that names exactly one existing project/goal (title or alias, whole words) is linked.
 */
export function linkTasksToProjects<
  T extends {
    title: string;
    description: string | null;
    context?: string | null;
    project_item_id?: string | null;
    project_title?: string | null;
  },
>(items: readonly T[], objects: readonly ExistingObject[]): T[] {
  const targets = objects.filter((o) => o.type === "project" || o.type === "goal");
  if (!targets.length) return [...items];
  return items.map((a) => {
    if (a.project_item_id) return a;
    const hay = wordsOf(`${a.title} ${a.description ?? ""} ${a.context ?? ""}`);
    const hits = targets.filter((o) =>
      [o.title, ...(o.aliases ?? [])].some((n) => {
        const w = wordsOf(n);
        return w.trim().length >= 4 && hay.includes(w);
      }),
    );
    return hits.length === 1
      ? { ...a, project_item_id: hits[0]!.id, project_title: hits[0]!.title }
      : a;
  });
}

export function normalizeActionItems(
  items: Enrichment["action_items"],
  objects: readonly ExistingObject[] = [],
): EnrichmentActionItem[] {
  const projects = projectIndex(objects);
  return items
    .filter((a) => a.title.trim())
    .map((a) => {
      const project = a.project?.trim() ? projects.get(matchKey(a.project)) : undefined;
      return {
        title: a.title.trim().slice(0, 200),
        description: a.description?.trim() || null,
        assignee: a.assignee.trim() || "Me",
        priority: (PRIORITIES as readonly string[]).includes(a.priority) ? a.priority : "medium",
        due_date: a.due_date && isIsoDate(a.due_date) ? a.due_date : null,
        source_timestamp_sec:
          typeof a.source_timestamp_sec === "number" && a.source_timestamp_sec >= 0
            ? Math.round(a.source_timestamp_sec)
            : null,
        project_item_id: project?.id ?? null,
        project_title: project?.title ?? null,
        timeframe: normalizeTimeframe(a.timeframe),
        context: a.context?.replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT) || null,
      };
    });
}

const clampTitle = (t: string): string => {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= MAX_TITLE) return s;
  const cut = s.slice(0, MAX_TITLE - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length).trim()}…`;
};

/** Item types the organizer may re-type (a note that is really a film tip, a page that is a product). */
export const RETYPABLE_TYPES: ReadonlySet<string> = new Set(["note", "article", "bookmark"]);
/** Below this placement confidence the type stays as captured. */
export const TYPE_SUGGESTION_MIN_CONFIDENCE = 0.7;
/** Item types whose mentioned books and tools become [[Wiki-Links]]. */
export const MENTION_TYPES: ReadonlySet<string> = new Set(["video", "podcast"]);
const MAX_MENTIONS = 8;

export function normalizeMentions(
  raw: Enrichment["mentions"],
  objects: readonly ExistingObject[],
): Mention[] {
  const index = new Map(objects.map((o) => [matchKey(o.title), o.title]));
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const m of raw ?? []) {
    const name = m.name.replace(/\s+/g, " ").trim().replace(/[[\]|]/g, "");
    const key = matchKey(name);
    if (!key || name.length > 120 || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: index.get(key) ?? name, kind: m.kind });
    if (out.length === MAX_MENTIONS) break;
  }
  return out;
}

/** Item types that get key points from the organizer. */
export const KEY_POINT_TYPES: ReadonlySet<string> = new Set(["article", "pdf", "epub"]);
const MAX_KEY_POINTS: Record<SummaryLevel, number> = { concise: 7, detailed: 10 };

function normalizeKeyPoints(
  raw: readonly string[] | null | undefined,
  max = MAX_KEY_POINTS.concise,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw ?? []) {
    const t = k
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t.slice(0, 300));
    if (out.length === max) break;
  }
  return out;
}

/** Appends a "## Kernpunkte" bullet section unless the content already has one. */
export function appendKeyPoints(contentMd: string, keyPoints: readonly string[]): string {
  if (keyPoints.length === 0) return contentMd;
  if (/^#{1,3}\s+(Kernpunkte|Kernaussagen|Key Takeaways|Key Points)\s*$/im.test(contentMd))
    return contentMd;
  return `${contentMd.trimEnd()}\n\n## ${ph("keyPoints")}\n\n${keyPoints.map((k) => `- ${k}`).join("\n")}\n`;
}

/** Applies the hard rules to raw model output. Pure, so it is tested without a model. */
export function normalizeEnrichment(
  raw: Enrichment,
  input: OrganizeInput,
  ctx: OrganizerContext,
): OrganizerResult {
  const { names, linked, suggested } = linkEntities(raw.entities, ctx.existingObjects);
  const autoCluster = input.autoClusterEnabled ?? true;
  return {
    title: clampTitle(raw.title || input.titleHint || ph("untitled")),
    summary: raw.summary.trim() || null,
    keyPoints: KEY_POINT_TYPES.has(input.type)
      ? normalizeKeyPoints(raw.key_points, MAX_KEY_POINTS[input.summaryLevel ?? "concise"])
      : [],
    clusterName:
      input.isManualPlacement || !autoCluster
        ? null
        : resolveCluster(raw.cluster_name, ctx.existingClusters),
    folderPath: input.isManualPlacement
      ? null
      : resolveFolderPath(raw.suggested_folder_path, input.type, ctx.folderPaths),
    placementConfidence: input.isManualPlacement ? null : placementConfidence(raw, input, ctx),
    tags: resolveTags(
      raw.tags,
      input.manualTags ?? [],
      ctx.existingTags,
      input.autoTagEnabled ?? true,
    ),
    entities: names,
    linkedEntities: linked,
    suggestedObjects: suggested,
    actionItems: normalizeActionItems(raw.action_items, ctx.existingObjects),
    suggestedType: suggestedTypeOf(raw, input, ctx),
    mentions: MENTION_TYPES.has(input.type) ? normalizeMentions(raw.mentions, ctx.existingObjects) : [],
  };
}

function suggestedTypeOf(
  raw: Enrichment,
  input: OrganizeInput,
  ctx: OrganizerContext,
): TypedExtractionType | null {
  if (!raw.suggested_type || !RETYPABLE_TYPES.has(input.type)) return null;
  // Own confidence for the type; the folder confidence (capped at 0.5 for a folder that does not
  // exist yet) only stands in when the model sent none.
  const own = raw.type_confidence;
  const c =
    typeof own === "number" && Number.isFinite(own)
      ? own
      : placementConfidence(raw, input, ctx);
  return c !== null && c >= TYPE_SUGGESTION_MIN_CONFIDENCE ? raw.suggested_type : null;
}

/** The model's confidence, capped at 0.5 when its folder suggestion could not be used as given. */
export function placementConfidence(
  raw: Enrichment,
  input: OrganizeInput,
  ctx: OrganizerContext,
): number | null {
  const c = raw.placement_confidence;
  if (typeof c !== "number" || !Number.isFinite(c)) return null;
  const clamped = Math.min(1, Math.max(0, c));
  const suggested = raw.suggested_folder_path
    ?.trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  // Objects are always filed in their type folder, a differently named suggestion is no doubt.
  if (!suggested || isDomainObjectType(input.type)) return clamped;
  const used = resolveFolderPath(raw.suggested_folder_path, input.type, ctx.folderPaths);
  return used.toLowerCase() === suggested.toLowerCase() ? clamped : Math.min(clamped, 0.5);
}

/** Result used when the model call fails: the item is still saved, just unenriched. */
export function fallbackEnrichment(input: OrganizeInput, ctx: OrganizerContext): OrganizerResult {
  const firstHeading = input.contentMd.match(/^#{1,3}\s+(.+)$/m)?.[1];
  return normalizeEnrichment(
    {
      title: input.titleHint ?? firstHeading ?? input.contentMd.slice(0, 60),
      summary: "",
      key_points: [],
      cluster_name: null,
      suggested_folder_path: null,
      // Nothing was understood: always ask the user.
      placement_confidence: 0,
      tags: [],
      entities: [],
      action_items: [],
      suggested_type: null,
      type_confidence: null,
      mentions: [],
    },
    { ...input, autoClusterEnabled: false },
    ctx,
  );
}

/** Zero-setup tagging, clustering, entity linking and task extraction for one item. */
export async function organize(
  input: OrganizeInput,
  ctx: OrganizerContext,
  options: OrganizeOptions,
): Promise<OrganizerResult> {
  const max = options.maxContentChars ?? 24_000;
  const truncated = input.contentMd.length > max;
  const system = renderOrganizerPrompt({
    existingClusters: ctx.existingClusters,
    existingTags: ctx.existingTags,
    existingObjects: ctx.existingObjects,
    manualPlacement: input.isManualPlacement,
    summaryLevel: input.summaryLevel,
    routingGuide: ctx.routingGuide,
  });
  const { output } = await generateText({
    model: options.model,
    system,
    prompt: renderOrganizerUserMessage({
      type: input.type,
      sourcePlatform: input.sourcePlatform,
      titleHint: input.titleHint,
      sourceUrl: input.sourceUrl,
      outline: input.outline?.slice(0, 60),
      content: truncated ? input.contentMd.slice(0, max) : input.contentMd,
      truncated,
    }),
    output: Output.object({ schema: EnrichmentSchema, name: "enrichment" }),
    temperature: 0.2,
    abortSignal: options.abortSignal,
  });
  return normalizeEnrichment(output, input, ctx);
}

/**
 * The `person` object whose e-mail address is the mail's sender (exact, case-insensitive), as a
 * link target. Null when nobody has that address: no guessing from the display name.
 */
export function senderPerson(
  sender: unknown,
  objects: readonly ExistingObject[],
): LinkedEntity | null {
  const address = typeof sender === "string" ? sender.trim().toLowerCase() : "";
  if (!address.includes("@")) return null;
  const hit = objects.find((o) => o.type === "person" && o.emails?.includes(address));
  return hit ? { name: hit.title, type: "person", objectId: hit.id, objectType: "person" } : null;
}

/** Appends `[[Wiki-Links]]` to linked objects so backlinks work in the vault. */
export function appendWikiLinks(contentMd: string, linked: readonly LinkedEntity[]): string {
  const titles = dedupe(
    linked.map((l) => l.name),
    matchKey,
  );
  if (titles.length === 0) return contentMd;
  return `${contentMd.trimEnd()}\n\n## ${ph("linked")}\n\n${titles.map((t) => `- [[${t}]]`).join("\n")}\n`;
}

const MENTION_LABEL: Record<Mention["kind"], ContentPhraseKey> = {
  book: "mentionBook",
  tool: "mentionTool",
};

/**
 * Appends "## Erwähnt" with [[Wiki-Links]] to the books and tools a video or podcast talks about.
 * Names that already got a link through "Verknüpft" (linked objects) are skipped.
 */
export function appendMentions(
  contentMd: string,
  mentions: readonly Mention[],
  linked: readonly LinkedEntity[] = [],
): string {
  const done = new Set(linked.map((l) => matchKey(l.name)));
  const fresh = mentions.filter((m) => !done.has(matchKey(m.name)));
  if (fresh.length === 0) return contentMd;
  const lines = fresh.map((m) => `- [[${m.name}]] (${ph(MENTION_LABEL[m.kind])})`);
  return [contentMd.trimEnd(), "", `## ${ph("mentioned")}`, "", ...lines, ""].join("\n");
}
