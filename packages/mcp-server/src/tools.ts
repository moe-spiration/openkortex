import type { Locale } from "./i18n";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  DOMAIN_OBJECT_FOLDERS,
  KNOWLEDGE_ITEM_TYPES,
  PRIORITIES,
  typeDefinition,
  DOMAIN_OBJECT_TYPES,
  metadataFields as metadataFieldNames,
  normalizeTimeframe,
  typeStatuses,
  validateTypeMetadata,
  type KnowledgeItemType,
} from "@kortex/db";
import { AGENTS_GUIDE_ID, AGENTS_GUIDE_URI, renderAgentsDocument } from "./agents-guide";
import { OBJECT_FIELDS, validateObjectMetadata } from "./objects";
import {
  READ_STATUSES,
  READING_TYPES,
  checkSectionBody,
  readStatusPatch,
  upsertSection,
} from "./reading";
import {
  isEnrichable,
  type BrainItem,
  type BrainRepository,
  type Embedder,
  type EnrichmentOutcome,
  type ItemEnricher,
  type ItemPatch,
} from "./repository";
import {
  BrainError,
  isoDate,
  normalizeDueDate,
  normalizeFolderPath,
  normalizeTags,
  slugify,
} from "./util";
import { brand } from "@kortex/i18n";

export interface ToolContext {
  repo: BrainRepository;
  /** Without an embedder (or when it fails) search falls back to full-text only. */
  embedder?: Embedder;
  /**
   * Organizer flag (KORTEX_MCP_ORGANIZE): brain_save_item / brain_log_agent_memory run the
   * ai-core organizer, chunker and embeddings on the new item. Failures never lose the item.
   */
  enricher?: ItemEnricher;
  now?: () => Date;
  /**
   * The user's language (`kortex.user_settings.locale`). The HTTP server runs each request of this
   * context in it; unset keeps the process-wide language (stdio: set once at start-up).
   */
  locale?: Locale;
}

export const AI_MEMORIES_FOLDER = "40_AI_Memories";
const INBOX_FOLDER = "00_Inbox";
export const AI_MEMORY_CLUSTER = "AI & Engineering";

type EnrichmentReport =
  (EnrichmentOutcome & { ok: true }) | { ok: false; status: "failed"; error: string };

/** Runs the enricher if configured; returns the final item and a short report for the agent. */
async function maybeEnrich(
  ctx: ToolContext,
  item: BrainItem,
  opts: { keepFolder?: boolean } = {},
): Promise<{ item: BrainItem; enrichment?: EnrichmentReport }> {
  const { enricher, repo } = ctx;
  if (!enricher || !isEnrichable(repo)) return { item };
  try {
    const outcome = await enricher.enrich(item, repo, opts);
    return { item: (await repo.getItem(item.id)) ?? item, enrichment: { ok: true, ...outcome } };
  } catch (e) {
    console.error(`[kortex-mcp] organizer failed for ${item.id}:`, errorMessage(e));
    return { item, enrichment: { ok: false, status: "failed", error: errorMessage(e) } };
  }
}

const ok = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});

const errorMessage = (e: unknown): string =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : String(e);

/** Wraps a handler: expected failures become tool errors the agent can read and correct. */
function guarded<A>(name: string, fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof BrainError) return fail(e.message);
      console.error(`[kortex-mcp] ${name} failed:`, e);
      return fail(`${name} failed: ${errorMessage(e)}`);
    }
  };
}

const requireArg = <T>(value: T | undefined, name: string, action: string): T => {
  if (value === undefined || value === "")
    throw new BrainError(`"${name}" is required for action "${action}"`);
  return value;
};

const requireNonEmpty = <T>(value: readonly T[] | undefined, name: string, action: string) => {
  if (!value || value.length === 0)
    throw new BrainError(`"${name}" is required for action "${action}"`);
  return value;
};

const notFound = (what: string, id: string) => new BrainError(`${what} ${id} not found`);

/**
 * Default folder for new items, from the type registry: a type with a home folder of its own
 * (objects, book, movie, recipe, meeting, daily_note, ai_chat, ...: `inferFromFolder`) goes there;
 * generic types (note, article, video, ...) go to the Inbox for the AI organizer.
 */
export function defaultFolder(type: KnowledgeItemType): string {
  const def = typeDefinition(type);
  return def?.inferFromFolder ? def.folder : INBOX_FOLDER;
}

const tagList = z
  .array(z.string().min(1).max(64))
  .max(20)
  .describe('Lowercase tags; hierarchical with "/" (e.g. "ai/mcp"). A leading "#" is stripped.');

/** The agents guide with the user's live folder index (guide only if the index fails). */
export async function agentsDocument(repo: BrainRepository): Promise<string> {
  let folders = null;
  try {
    folders = (await repo.folderIndex?.()) ?? null;
  } catch (e) {
    console.error("[kortex-mcp] folder index failed:", errorMessage(e));
  }
  return renderAgentsDocument(folders, { indexTitle: "Folder index (live)" });
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  const { repo, embedder } = ctx;
  const now = ctx.now ?? (() => new Date());

  server.registerResource(
    "agents-guide",
    AGENTS_GUIDE_URI,
    {
      title: brand("Kortex agents guide"),
      description:
        "Where things live in the user's second brain: vault folders, routing rules, item types, domain objects, " +
        "frontmatter, MCP tool examples and the live folder index with item counts.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: await agentsDocument(repo) }],
    }),
  );

  server.registerTool(
    "brain_search",
    {
      title: "Search the second brain",
      description:
        brand("Search the user's Kortex knowledge base (notes, articles, meetings, recipes, AI memories, domain objects...). ") +
        "Uses hybrid semantic + full-text search when available, otherwise full-text only. " +
        "Returns ranked hits with id, title, snippet, folder, tags and metadata (status, rating, ...); use brain_get_item to read an item in full. " +
        'Filters: type/types (every registry type, e.g. scratchpad, session, prompt), remind_due_by (due reminders of any type), status (shorthand for metadata.status, e.g. "want_to_read", "to_watch", "wishlist"), metadata (exact key match), folder_path, tags. ' +
        "Without a query the newest items matching the filters are listed (e.g. all books with status want_to_read). " +
        `Reading queue: unread true lists clippings and documents (${READING_TYPES.join(", ")} unless type/types say otherwise) the user has not read or skipped and that are not snoozed; with a query (e.g. today's goals and projects) they are ranked by it, and each hit carries its summary. Mark them with brain_organize set_read_status. ` +
        "Before saving something the user refers to (a book, film, person, product), search for it first and update the hit with brain_save_item(id) instead of creating a duplicate. " +
        `Where things live (folders, types, routing rules, folder index): brain_get_item with id "${AGENTS_GUIDE_ID}".`,
      inputSchema: {
        query: z
          .string()
          .max(500)
          .optional()
          .describe("Natural-language or keyword query. Omit to list by filters only."),
        type: z.enum(KNOWLEDGE_ITEM_TYPES).optional().describe("Only items of this type."),
        types: z
          .array(z.enum(KNOWLEDGE_ITEM_TYPES))
          .max(20)
          .optional()
          .describe('Only items of any of these types, e.g. ["book", "epub"].'),
        status: z
          .string()
          .min(1)
          .max(40)
          .optional()
          .describe('Lifecycle status, shorthand for metadata.status (e.g. "read", "watched").'),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe(
            'Exact metadata match, e.g. {"author": "Frank Herbert"}; array fields match if they contain the value.',
          ),
        folder_path: z
          .string()
          .optional()
          .describe(
            'Only items in this folder or its sub-folders, e.g. "70_Objects" or "30_Clippings".',
          ),
        tags: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Only items having ALL of these tags; "ai" also matches "ai/mcp".'),
        remind_due_by: z
          .string()
          .optional()
          .describe(
            "Due reminders: only items whose remind_at is at or before this ISO 8601 instant (e.g. now = what is due). Oldest reminder first when there is no query.",
          ),
        unread: z
          .boolean()
          .optional()
          .describe(
            "Reading queue: only unread, not snoozed clippings/documents (metadata.read_status not read or skipped).",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results (default 10, max 50)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("brain_search", async (args) => {
      const query = args.query?.trim() ?? "";
      const metadata = {
        ...args.metadata,
        ...(args.status ? { status: args.status } : {}),
      };
      const hasFilter =
        !!args.type ||
        !!args.types?.length ||
        Object.keys(metadata).length > 0 ||
        !!args.folder_path ||
        !!args.tags?.length ||
        !!args.remind_due_by ||
        !!args.unread;
      if (!query && !hasFilter)
        throw new BrainError(
          "Give a query or at least one filter (type, status, metadata, folder_path, tags, remind_due_by, unread)",
        );
      const readingDefault = args.unread && !args.type && !args.types?.length;
      let embedding: number[] | null = null;
      if (embedder && query) {
        try {
          embedding = await embedder.embed(query);
        } catch (e) {
          console.error(
            "[kortex-mcp] embedding failed, falling back to full-text:",
            errorMessage(e),
          );
        }
      }
      const results = await repo.search({
        query,
        embedding,
        embeddingModel: embedding ? (embedder?.modelKey ?? null) : null,
        type: args.type,
        types: args.types?.length ? args.types : readingDefault ? [...READING_TYPES] : undefined,
        metadata: Object.keys(metadata).length ? metadata : undefined,
        unreadAt: args.unread ? now().toISOString() : undefined,
        folderPath: args.folder_path ? normalizeFolderPath(args.folder_path) : undefined,
        tags: args.tags?.length ? normalizeTags(args.tags) : undefined,
        remindDueBy: args.remind_due_by
          ? (normalizeRemindAt(args.remind_due_by) ?? undefined)
          : undefined,
        limit: args.limit ?? 10,
      });
      const mode = !query ? "filter" : embedding ? "hybrid" : "fulltext";
      return ok({ mode, count: results.length, results });
    }),
  );

  server.registerTool(
    "brain_get_item",
    {
      title: "Read an item",
      description:
        "Fetch one knowledge item by id with its full Markdown content, metadata, tags and folder. " +
        "Set include_highlights to also get the user's highlights and annotations on it. " +
        `id "${AGENTS_GUIDE_ID}" returns the agents guide instead: vault structure, routing rules, domain objects, ` +
        `tool examples and the user's live folder index (also the resource ${AGENTS_GUIDE_URI}). Read it once before saving or organizing.`,
      inputSchema: {
        id: z
          .union([z.uuid(), z.literal(AGENTS_GUIDE_ID)])
          .describe(`Item id (from brain_search or brain_save_item), or "${AGENTS_GUIDE_ID}".`),
        include_highlights: z
          .boolean()
          .optional()
          .describe("Also return highlights (default false)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("brain_get_item", async (args) => {
      if (args.id === AGENTS_GUIDE_ID) {
        return ok({
          item: {
            id: AGENTS_GUIDE_ID,
            title: brand("Kortex agents guide"),
            uri: AGENTS_GUIDE_URI,
            content_md: await agentsDocument(repo),
          },
        });
      }
      const item = await repo.getItem(args.id);
      if (!item) throw notFound("Item", args.id);
      const highlights = args.include_highlights ? await repo.getHighlights(item.id) : undefined;
      return ok({ item, ...(highlights && { highlights }) });
    }),
  );

  server.registerTool(
    "brain_save_item",
    {
      title: "Save an item",
      description:
        "Save a new item (note, article, recipe, book, movie, ...) into the user's brain as Markdown, or update an existing one by id. " +
        "Create never makes a duplicate: the same URL, external id (isbn, imdb_id), content or object title is merged into the existing item " +
        "(response: duplicate.reason; tags/metadata are added, nothing is overwritten). " +
        "Update (id): only the given fields change; metadata is merged key-wise (null removes a key) and validated against the type " +
        '(e.g. book: status want_to_read|reading|read, rating 0-10, feedback). For "I finished book X, loved it": brain_search, then ' +
        'brain_save_item with id + metadata {status: "read", feedback, rating}. Never create a new note when the entry exists. ' +
        "Without folder_path the item lands in the Inbox (or the type's home folder) and the AI organizer files it later; " +
        "an explicit folder_path is treated as manual placement and is never moved by the organizer. " +
        "Managed section: section (a heading) + content_md replaces only the \"## <section>\" part of the note given by id, or of the daily note of date (YYYY-MM-DD, created if missing), " +
        "and keeps everything else; calling it again replaces the same section (e.g. an assistant's morning brief in today's daily note). Section content uses ### and deeper headings. " +
        "Prefer brain_log_agent_memory for session summaries. " +
        `Folder and routing rules: brain_get_item with id "${AGENTS_GUIDE_ID}".`,
      inputSchema: {
        id: z
          .uuid()
          .optional()
          .describe("Update this existing item (from brain_search) instead of creating one."),
        title: z.string().min(1).max(300).optional().describe("Required when creating."),
        content_md: z
          .string()
          .max(500_000)
          .optional()
          .describe(
            "Clean Markdown body (no frontmatter). Required when creating; replaces the body on update.",
          ),
        type: z.enum(KNOWLEDGE_ITEM_TYPES).optional().describe('Default "note".'),
        metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Type-specific fields (validated against the type), e.g. book {status, author, isbn, rating, feedback}, movie {status, kind, year, imdb_id}. Merged key-wise; null removes a key.",
          ),
        remind_at: z
          .string()
          .nullable()
          .optional()
          .describe("ISO 8601 timestamp to resurface the item; null clears it."),
        folder_path: z
          .string()
          .optional()
          .describe('e.g. "10_Notes" or "Work/Clients"; created if missing.'),
        source_url: z
          .url({ protocol: /^https?$/ })
          .optional()
          .describe("Origin URL, if any."),
        tags: tagList.optional(),
        section: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[^\n#]+$/, "one line, without #")
          .optional()
          .describe(
            'Heading of a managed section, e.g. "Noema Brief": content_md replaces only this "## " section of the note (id) or daily note (date).',
          ),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
          .optional()
          .describe("With section: the daily note of this date (10_Notes/Daily/<date>.md), created if missing."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guarded("brain_save_item", async (args) => {
      if (args.section !== undefined || args.date !== undefined) return ok(await saveSection(ctx, args));
      const remindAt = args.remind_at === undefined ? undefined : normalizeRemindAt(args.remind_at);
      if (args.id) {
        const existing = await repo.getItem(args.id);
        if (!existing) throw notFound("Item", args.id);
        const type = args.type ?? existing.type;
        const metadata = args.metadata ? checkMetadata(type, args.metadata) : undefined;
        if (args.type && args.type !== existing.type && !args.metadata)
          checkMetadata(type, typedFields(type, existing.metadata));
        const patch: ItemPatch = {
          ...(args.type && { type: args.type }),
          ...(args.title && { title: args.title.trim() }),
          ...(args.content_md !== undefined && { content_md: args.content_md }),
          ...(args.source_url && { source_url: args.source_url }),
          ...(args.tags && { tags: [...new Set([...existing.tags, ...normalizeTags(args.tags)])] }),
          ...(remindAt !== undefined && { remind_at: remindAt }),
          ...(metadata && { metadata }),
          // An explicit folder on update is a deliberate move (manual placement).
          ...(args.folder_path && {
            folder_path: normalizeFolderPath(args.folder_path),
            is_manual_placement: true,
          }),
        };
        const item = await repo.updateItem(args.id, patch);
        if (!item) throw notFound("Item", args.id);
        const done =
          args.content_md !== undefined
            ? await maybeEnrich(ctx, item, { keepFolder: true })
            : { item };
        return ok({
          updated: true,
          ...pick(done.item, [
            "id",
            "title",
            "type",
            "folder_path",
            "tags",
            "metadata",
            "remind_at",
          ]),
          ...(done.enrichment && { enrichment: done.enrichment }),
        });
      }
      const title = requireArg(args.title?.trim(), "title", "create");
      const content = args.content_md ?? "";
      const type = args.type ?? "note";
      const metadata = args.metadata ? checkMetadata(type, args.metadata) : undefined;
      const explicitFolder = args.folder_path ? normalizeFolderPath(args.folder_path) : undefined;
      const saved = await repo.saveItem({
        type,
        title,
        slug: slugify(title),
        content_md: content,
        source_url: args.source_url ?? null,
        folder_path: explicitFolder ?? defaultFolder(type),
        is_manual_placement: explicitFolder !== undefined,
        tags: normalizeTags(args.tags),
        ...(metadata && { metadata: stripNulls(metadata) }),
        ...(remindAt !== undefined && { remind_at: remindAt }),
      });
      const fields = ["id", "title", "type", "slug", "folder_path", "tags", "status"] as const;
      if (saved.duplicate) {
        return ok({
          ...pick(saved.item, fields),
          duplicate: {
            reason: saved.duplicate.reason,
            note: "Already in the brain: merged into the existing item (nothing overwritten). Use id to update it.",
          },
        });
      }
      const done = await maybeEnrich(ctx, saved.item);
      return ok({
        ...pick(done.item, fields),
        ...(done.enrichment && { enrichment: done.enrichment }),
      });
    }),
  );

  server.registerTool(
    "brain_organize",
    {
      title: "Organize the brain",
      description:
        "Structure the knowledge base. Actions: " +
        "create_folder (folder_path), " +
        "move_item (item_id + folder_path; folder is created if missing and the placement becomes manual, so the AI organizer will not move it again), " +
        "add_tags (item_id + tags), " +
        "snooze (item_id + date as ISO 8601: sets the reminder remind_at so the item resurfaces then; works for every type, e.g. scratchpad, session, prompt), " +
        "clear_reminder (item_id: removes the reminder), " +
        `set_read_status (item_id + read_status [${READ_STATUSES.join("|")}]: reading state of a clipping or document, sets metadata.read_status and read_at; unread clears it; brain_search unread lists the rest), ` +
        `turn_into_object (item_id + object_type [${DOMAIN_OBJECT_TYPES.join("|")}] + optional metadata: retypes a note into a domain object stored in 70_Objects/<Type>; ` +
        "metadata fields per type: " +
        DOMAIN_OBJECT_TYPES.map((t) => `${t}: ${OBJECT_FIELDS[t].join(", ")}`).join("; ") +
        "; unknown fields are rejected).",
      inputSchema: {
        action: z.enum([
          "create_folder",
          "move_item",
          "add_tags",
          "snooze",
          "clear_reminder",
          "set_read_status",
          "turn_into_object",
        ]),
        folder_path: z
          .string()
          .optional()
          .describe("create_folder / move_item: target folder path."),
        item_id: z
          .uuid()
          .optional()
          .describe(
            "move_item / add_tags / snooze / clear_reminder / set_read_status / turn_into_object: the item.",
          ),
        date: z
          .string()
          .optional()
          .describe("snooze: ISO 8601 date or timestamp to resurface the item."),
        tags: tagList.optional().describe("add_tags: tags to add."),
        read_status: z.enum(READ_STATUSES).optional().describe("set_read_status: the new state."),
        object_type: z
          .enum(DOMAIN_OBJECT_TYPES)
          .optional()
          .describe("turn_into_object: target object type."),
        metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "turn_into_object: type-specific properties (validated against the object type).",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded("brain_organize", async (args) => {
      const { action } = args;
      switch (action) {
        case "create_folder": {
          const path = normalizeFolderPath(requireArg(args.folder_path, "folder_path", action));
          return ok({ action, ...(await repo.ensureFolder(path)) });
        }
        case "move_item": {
          const id = requireArg(args.item_id, "item_id", action);
          const path = normalizeFolderPath(requireArg(args.folder_path, "folder_path", action));
          const item = await repo.updateItem(id, { folder_path: path, is_manual_placement: true });
          if (!item) throw notFound("Item", id);
          return ok({
            action,
            ...pick(item, ["id", "title", "folder_path", "is_manual_placement"]),
          });
        }
        case "add_tags": {
          const id = requireArg(args.item_id, "item_id", action);
          const tags = normalizeTags(requireNonEmpty(args.tags, "tags", action));
          const item = await repo.addTags(id, tags);
          if (!item) throw notFound("Item", id);
          return ok({ action, ...pick(item, ["id", "title", "tags"]) });
        }
        case "snooze": {
          const id = requireArg(args.item_id, "item_id", action);
          const date = normalizeRemindAt(requireArg(args.date, "date", action));
          const item = await repo.updateItem(id, { remind_at: date });
          if (!item) throw notFound("Item", id);
          return ok({ action, ...pick(item, ["id", "title", "type", "remind_at"]) });
        }
        case "clear_reminder": {
          const id = requireArg(args.item_id, "item_id", action);
          const item = await repo.updateItem(id, { remind_at: null });
          if (!item) throw notFound("Item", id);
          return ok({ action, ...pick(item, ["id", "title", "type", "remind_at"]) });
        }
        case "set_read_status": {
          const id = requireArg(args.item_id, "item_id", action);
          const status = requireArg(args.read_status, "read_status", action);
          const existing = await repo.getItem(id);
          if (!existing) throw notFound("Item", id);
          if (typeDefinition(existing.type)?.metadata)
            throw new BrainError(
              `set_read_status is for clippings and documents; ${existing.type} has its own status (brain_save_item metadata.status)`,
            );
          const item = await repo.updateItem(id, { metadata: readStatusPatch(status, now()) });
          if (!item) throw notFound("Item", id);
          return ok({ action, ...pick(item, ["id", "title", "type", "metadata"]) });
        }
        case "turn_into_object": {
          const id = requireArg(args.item_id, "item_id", action);
          const objectType = requireArg(args.object_type, "object_type", action);
          const checked = validateObjectMetadata(objectType, args.metadata ?? {});
          if (!checked.ok) throw new BrainError(checked.error);
          const existing = await repo.getItem(id);
          if (!existing) throw notFound("Item", id);
          // A folder the user (or an agent) placed the item in on purpose stays untouched.
          const folderPatch = existing.is_manual_placement
            ? {}
            : { folder_path: DOMAIN_OBJECT_FOLDERS[objectType] };
          const item = await repo.updateItem(id, {
            type: objectType,
            metadata: checked.metadata,
            ...folderPatch,
          });
          if (!item) throw notFound("Item", id);
          return ok({ action, ...pick(item, ["id", "title", "type", "folder_path", "metadata"]) });
        }
      }
    }),
  );

  server.registerTool(
    "brain_log_agent_memory",
    {
      title: "Log an agent memory",
      description:
        "Archive a coding/architecture/research session in the user's brain: call at the end of a significant session " +
        'or when the user says "wrap up" / "save memory". Creates an ai_chat item in 40_AI_Memories named YYYY-MM-DD_topic-slug ' +
        "with the summary, decisions and next steps.",
      inputSchema: {
        agent_name: z.string().min(1).max(100).describe('Who is writing, e.g. "Claude Code".'),
        topic: z.string().min(1).max(200).describe("Short topic; becomes the title and file name."),
        summary_md: z
          .string()
          .min(1)
          .max(100_000)
          .describe("Markdown summary: what was done, solved bugs, reusable patterns."),
        decisions: z.array(z.string().min(1)).max(50).optional().describe("Key decisions made."),
        next_steps: z.array(z.string().min(1)).max(50).optional().describe("Open next steps."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guarded("brain_log_agent_memory", async (args) => {
      const date = isoDate(now());
      const topic = args.topic.trim();
      const agent = args.agent_name.trim();
      const bullets = (items?: string[]) => (items ?? []).map((s) => `- ${s.trim()}`).join("\n");
      const content = [
        `# ${topic}`,
        `*Agent: ${agent} · ${date}*`,
        args.summary_md.trim(),
        args.decisions?.length ? `## Decisions\n\n${bullets(args.decisions)}` : "",
        args.next_steps?.length ? `## Next steps\n\n${bullets(args.next_steps)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const item = await repo.createItem({
        type: "ai_chat",
        title: topic,
        slug: `${date}_${slugify(topic, "session")}`,
        content_md: `${content}\n`,
        folder_path: AI_MEMORIES_FOLDER,
        cluster_name: AI_MEMORY_CLUSTER,
        tags: ["ai/agent-memory", `agent/${slugify(agent, "agent")}`],
        metadata: {
          agent_name: agent,
          topic,
          decisions: args.decisions ?? [],
          next_steps: args.next_steps ?? [],
        },
      });
      // Agent memories always live in 40_AI_Memories (spec 5.3): the organizer may tag, not move.
      const done = await maybeEnrich(ctx, item, { keepFolder: true });
      return ok({
        ...pick(done.item, ["id", "title", "folder_path", "slug", "tags"]),
        file: `${done.item.folder_path}/${done.item.slug}.md`,
        ...(done.enrichment && { enrichment: done.enrichment }),
      });
    }),
  );

  server.registerTool(
    "brain_manage_tasks",
    {
      title: "Manage tasks",
      description:
        "List, create, update or complete the user's action items. " +
        "list: open and in-progress tasks sorted by due date (include_done adds finished ones; filter by project_id, timeframe, exported true|false); " +
        "create: title (+ optional due_date as ISO 8601, priority low|medium|high|urgent (default medium), timeframe, context, project_id); " +
        "update: task_id + any of title, priority, due_date (null clears), timeframe, context, project_id (a project/goal item id, null clears), exported (true marks it as transferred to another tool); " +
        "complete: task_id.",
      inputSchema: {
        action: z.enum(["list", "create", "update", "complete"]),
        title: z.string().min(1).max(300).optional().describe("create / update: task title."),
        task_id: z.uuid().optional().describe("update / complete: the task id (from list)."),
        due_date: z
          .string()
          .nullable()
          .optional()
          .describe("create / update: ISO 8601 date or timestamp, e.g. 2026-11-01; null clears."),
        priority: z.enum(PRIORITIES).optional().describe("create (default medium) / update."),
        timeframe: z
          .string()
          .max(100)
          .nullable()
          .optional()
          .describe(
            'create / update / list filter: "today", "this_week", "later" or a day YYYY-MM-DD (German labels like "diese Woche" are accepted); null clears.',
          ),
        context: z
          .string()
          .max(500)
          .nullable()
          .optional()
          .describe(
            "create / update: one short sentence, why / where the task comes from; null clears.",
          ),
        project_id: z
          .uuid()
          .nullable()
          .optional()
          .describe(
            "create / update / list filter: id of the project or goal item the task belongs to.",
          ),
        include_done: z.boolean().optional().describe("list: also return completed tasks."),
        exported: z
          .boolean()
          .optional()
          .describe(
            "update: true = transferred to another task tool (sets exported_at), false clears. list: only tasks that are (true) or are not (false) transferred yet.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded("brain_manage_tasks", async (args) => {
      const { action } = args;
      switch (action) {
        case "list": {
          const timeframe = args.timeframe ? checkTimeframe(args.timeframe) : undefined;
          const tasks = await repo.listTasks({
            includeDone: args.include_done ?? false,
            ...(args.project_id && { project_item_id: args.project_id }),
            ...(timeframe && { timeframe }),
            ...(args.exported !== undefined && { exported: args.exported }),
          });
          return ok({ action, count: tasks.length, tasks });
        }
        case "create": {
          const title = requireArg(args.title?.trim(), "title", action);
          const { task, duplicate } = await repo.createTask({
            title,
            priority: args.priority ?? "medium",
            due_date: args.due_date ? normalizeDueDate(args.due_date) : null,
            timeframe: args.timeframe ? checkTimeframe(args.timeframe) : null,
            context: cleanContext(args.context),
            project_item_id: args.project_id ? await checkProject(repo, args.project_id) : null,
          });
          // An open task with the same title is returned instead of a second copy.
          return ok({ action, task, ...(duplicate && { duplicate: true }) });
        }
        case "update": {
          const id = requireArg(args.task_id, "task_id", action);
          const patch = {
            ...(args.title !== undefined && { title: args.title.trim() }),
            ...(args.priority !== undefined && { priority: args.priority }),
            ...(args.due_date !== undefined && {
              due_date: args.due_date === null ? null : normalizeDueDate(args.due_date),
            }),
            ...(args.timeframe !== undefined && {
              timeframe: args.timeframe ? checkTimeframe(args.timeframe) : null,
            }),
            ...(args.context !== undefined && { context: cleanContext(args.context) }),
            ...(args.project_id !== undefined && { project_item_id: args.project_id }),
            ...(args.exported !== undefined && { exported: args.exported }),
          };
          if (Object.keys(patch).length === 0)
            throw new BrainError(
              "Nothing to update: give title, priority, due_date, timeframe, context, project_id or exported",
            );
          if (args.project_id) await checkProject(repo, args.project_id);
          const task = await repo.updateTask(id, patch);
          if (!task) throw notFound("Task", id);
          return ok({ action, task });
        }
        case "complete": {
          const id = requireArg(args.task_id, "task_id", action);
          const task = await repo.completeTask(id);
          if (!task) throw notFound("Task", id);
          return ok({ action, task });
        }
      }
    }),
  );
}

/** Normalised timeframe (today | this_week | later | YYYY-MM-DD); anything else is an error, never stored. */
function checkTimeframe(raw: string): string {
  const tf = normalizeTimeframe(raw);
  if (!tf)
    throw new BrainError(
      `Invalid timeframe "${raw}": use today, this_week, later or a day YYYY-MM-DD`,
    );
  return tf;
}

const cleanContext = (raw: string | null | undefined): string | null =>
  raw?.replace(/\s+/g, " ").trim() || null;

/** A task may only point at an existing project or goal object. */
async function checkProject(repo: BrainRepository, id: string): Promise<string> {
  const project = await repo.getItem(id);
  if (!project) throw notFound("Project", id);
  if (project.type !== "project" && project.type !== "goal")
    throw new BrainError(`Item ${id} is a ${project.type}, not a project or goal`);
  return id;
}

/** Validates metadata fields (null = remove, not validated) against the type's registry schema. */
const DAILY_FOLDER = "10_Notes/Daily";

/** brain_save_item with section/date: replace one "## " section of a note or a daily note. */
async function saveSection(
  ctx: ToolContext,
  args: { id?: string; section?: string; date?: string; content_md?: string },
): Promise<Record<string, unknown>> {
  const { repo } = ctx;
  const section = requireArg(args.section?.trim(), "section", "section");
  const body = requireArg(args.content_md, "content_md", "section");
  checkSectionBody(body);
  if (!args.id && !args.date) throw new BrainError('"id" or "date" is required with "section"');
  let item: BrainItem | null;
  let created = false;
  if (args.id) {
    item = await repo.getItem(args.id);
    if (!item) throw notFound("Item", args.id);
  } else {
    const date = args.date!;
    if (!repo.findDailyNote) throw new BrainError("Daily notes are not available in this store");
    item = await repo.findDailyNote(date);
    if (!item) {
      item = await repo.createItem({
        type: "daily_note",
        title: `Daily Journal ${date}`,
        slug: date,
        content_md: "",
        folder_path: DAILY_FOLDER,
        is_manual_placement: true,
        tags: ["daily"],
        metadata: { date },
      });
      created = true;
    }
  }
  const content_md = upsertSection(item.content_md, section, body);
  const updated = content_md === item.content_md ? item : await repo.updateItem(item.id, { content_md });
  if (!updated) throw notFound("Item", item.id);
  return {
    section,
    created,
    changed: updated !== item,
    ...pick(updated, ["id", "title", "type", "slug", "folder_path"]),
  };
}

function checkMetadata(type: string, metadata: Record<string, unknown>): Record<string, unknown> {
  const checked = validateTypeMetadata(type, stripNulls(metadata));
  if (!checked.ok) {
    const statuses = typeStatuses(type);
    throw new BrainError(
      statuses.length ? `${checked.error}. status: ${statuses.join("|")}` : checked.error,
    );
  }
  const nulls = Object.fromEntries(Object.entries(metadata).filter(([, v]) => v === null));
  return { ...checked.metadata, ...nulls };
}

const stripNulls = (m: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null));

/** The registry fields of existing metadata (system keys like ingest/sources are not validated). */
function typedFields(type: string, metadata: Record<string, unknown>): Record<string, unknown> {
  const fields = new Set(metadataFieldNames(type));
  return Object.fromEntries(Object.entries(metadata).filter(([k]) => fields.has(k)));
}

function normalizeRemindAt(value: string | null): string | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new BrainError(`remind_at "${value}" is not an ISO 8601 date`);
  return new Date(ms).toISOString();
}

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;
}
