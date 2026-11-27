import { randomUUID } from "node:crypto";
import {
  DEFAULT_FOLDER_BY_TYPE,
  toPgVector,
  typeIcon,
  type Insert,
  type ItemStatus,
  type Json,
  type KnowledgeItemType,
  type UserSettings,
} from "@kortex/db";
import { createDefaultRegistry, type DefaultRegistryDeps } from "../adapters";
import type { ExtractedPayload, IngestionAdapter, RawIngestInput } from "../adapters/base-adapter";
import {
  appendKeyPoints,
  appendMentions,
  appendWikiLinks,
  fallbackEnrichment,
  linkTasksToProjects,
  senderPerson,
  organize,
  type LinkedEntity,
  type OrganizeInput,
  type OrganizerContext,
  type OrganizerResult,
  type SuggestedObject,
} from "../enrichment/auto-organizer";
import { extractTyped, renderTypedFacts, type TypedPayload } from "../typed/extraction";
import { resolveItemType } from "../typed/resolve-type";
import { withEmailDigest } from "../email/parse";
import { chunkDocument, type ChunkerOptions } from "../enrichment/chunker";
import { embedTexts } from "../enrichment/embeddings";
import {
  AdapterDeclinedError,
  IngestionError,
  NotImplementedAdapterError,
  errorMessage,
} from "../errors";
import type { FetchLike } from "../http";
import type { IngestionRegistry } from "../router/ingestion-registry";
import {
  createModelRouter,
  modelFor,
  embeddingModelKeyFor,
  modelIdFor,
  type ModelRouter,
  type ModelSettings,
} from "../router/model-router";
import type { CatalogModel } from "../providers/catalog";
import type { DocumentParser } from "../providers/edenai";
import type { StorageGateway } from "../storage";
import { coverError, resolveCover, storeCover } from "../media/cover";
import { createGroqWhisperTranscriber } from "../audio/transcriber";
import { createDeepgramUrlTranscriber, downloadThenTranscribe } from "../audio/url-transcriber";
import { createPodcastIndexClient } from "../podcast/podcast-index";

// --- Types ---------------------------------------------------------------------------

export interface IngestContext extends OrganizerContext {
  /** The user's folders, to resolve `targetFolderId` and map paths to folder ids. */
  folders?: ReadonlyArray<{ id: string; folder_path: string }>;
  userSettings?: Partial<Pick<UserSettings, "auto_tag_enabled" | "auto_cluster_enabled">> | null;
}

export interface IngestDeps {
  registry: IngestionRegistry;
  models: ModelRouter;
  generateId?: () => string;
  now?: () => Date;
  chunker?: ChunkerOptions;
  embedBatchSize?: number;
  /** Verify and store covers in kortex-media (resolveCover). Off when not given (tests, scripts). */
  covers?: { storage: StorageGateway; fetch?: FetchLike };
}

export type KnowledgeItemInsert = Insert<"knowledge_items"> & {
  id: string;
  user_id: string;
  type: KnowledgeItemType;
  status: ItemStatus;
};
export type ItemChunkInsert = Insert<"item_chunks">;
export type ActionItemInsert = Insert<"action_items">;

/** Everything `/api/ingest` needs to persist. Nothing here has been written anywhere. */
export interface IngestResult {
  item: KnowledgeItemInsert;
  chunks: ItemChunkInsert[];
  actionItems: ActionItemInsert[];
  /** Final tag names on the item; upsert into kortex.tags (usage_count + 1). */
  tags: string[];
  /** AI-proposed sub-folder that does not exist yet (create it, then set folder_id). */
  folderToCreate: string | null;
  linkedEntities: LinkedEntity[];
  /** Entities that look like new domain objects ("Turn into object" suggestions). */
  suggestedObjects: SuggestedObject[];
  /** Original file, already uploaded through the StorageGateway. */
  file: ExtractedPayload["file"] | null;
  adapterId: string;
  skippedAdapters: Array<{ id: string; reason: string }>;
  warnings: string[];
}

// --- Helpers -----------------------------------------------------------------------------

const ICON_BY_TYPE: Partial<Record<KnowledgeItemType, string>> = {
  note: "notebook-pen",
  article: "newspaper",
  video: "circle-play",
  recipe: "chef-hat",
  pdf: "file-text",
  epub: "book-open",
  image: "image",
  meeting: "mic",
  podcast: "podcast",
  ai_chat: "bot",
  email: "mail",
  social: "share-2",
};

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Drops undefined values so the object is valid JSON for a jsonb column. */
const toJson = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? {})) as Json;

const isSkippable = (err: unknown) =>
  err instanceof AdapterDeclinedError || err instanceof NotImplementedAdapterError;

function validateInput(input: RawIngestInput): void {
  if (!input.userId) throw new IngestionError("invalid_input", "userId is required");
  if (!input.url && !input.rawText?.trim() && !input.fileBuffer) {
    throw new IngestionError("invalid_input", "one of url, rawText or fileBuffer is required");
  }
}

function resolveManualFolder(input: RawIngestInput, ctx: IngestContext): string | undefined {
  if (!input.targetFolderId) return undefined;
  const path =
    ctx.folders?.find((f) => f.id === input.targetFolderId)?.folder_path ?? input.targetFolderPath;
  if (!path) {
    throw new IngestionError(
      "invalid_input",
      `targetFolderId ${input.targetFolderId} is unknown; pass context.folders or input.targetFolderPath`,
    );
  }
  return path;
}

/** Tries adapters in priority order; declined and not-implemented adapters fall through. */
async function extractWithFallback(
  input: RawIngestInput,
  candidates: IngestionAdapter[],
): Promise<{
  payload: ExtractedPayload;
  adapterId: string;
  skipped: IngestResult["skippedAdapters"];
}> {
  const skipped: IngestResult["skippedAdapters"] = [];
  for (const adapter of candidates) {
    try {
      return { payload: await adapter.extract(input), adapterId: adapter.id, skipped };
    } catch (err) {
      if (!isSkippable(err)) throw err;
      skipped.push({ id: adapter.id, reason: errorMessage(err) });
    }
  }
  throw new IngestionError(
    "all_adapters_declined",
    `no adapter could extract this input (${skipped.map((s) => s.reason).join("; ")})`,
  );
}

// --- Pipeline -------------------------------------------------------------------------------

/**
 * resolve adapter → extract → organize → chunk → embed.
 * Returns DB-ready inserts; persistence happens in apps/web `/api/ingest`.
 * LLM failures degrade (item saved unenriched / without embeddings) and are listed in `warnings`.
 */
export async function ingest(
  input: RawIngestInput,
  context: IngestContext,
  deps: IngestDeps,
): Promise<IngestResult> {
  validateInput(input);
  const manualFolderPath = resolveManualFolder(input, context);
  const itemId = input.itemId ?? (deps.generateId ?? randomUUID)();
  const withId: RawIngestInput = { ...input, itemId };
  const warnings: string[] = [];

  const candidates = deps.registry.candidates(withId);
  if (candidates.length === 0)
    throw new IngestionError("no_adapter", "no adapter can handle this input");
  const { payload, adapterId, skipped } = await extractWithFallback(withId, candidates);

  // Cover: the client's image, the adapter's, its fallbacks, then provider/page candidates.
  let coverUrl = payload.coverImageUrl ?? input.imageUrl ?? null;
  let coverMeta: Record<string, unknown> | null = null;
  if (deps.covers) {
    try {
      const extra = Array.isArray(payload.metadata.cover_candidates)
        ? (payload.metadata.cover_candidates as string[])
        : [];
      const { cover, tried } = await resolveCover({
        url: payload.sourceUrl ?? input.url,
        candidates: [input.imageUrl, payload.coverImageUrl, ...extra],
        ...(deps.covers.fetch ? { fetch: deps.covers.fetch } : {}),
      });
      if (cover) {
        const stored = await storeCover(deps.covers.storage, input.userId, itemId, cover);
        if (stored.url) coverUrl = stored.url;
        coverMeta = {
          source_url: cover.sourceUrl,
          storage_path: stored.path,
          width: cover.width,
          height: cover.height,
        };
      } else if (tried) {
        warnings.push(`cover: none of ${tried} candidates is a usable image`);
      }
    } catch (err) {
      warnings.push(coverError(err));
    }
  }

  // Organize
  const isManualPlacement = manualFolderPath !== undefined;
  const organizeInput: OrganizeInput = {
    type: payload.type,
    sourcePlatform: payload.sourcePlatform,
    contentMd: payload.contentMd,
    titleHint: payload.titleHint,
    sourceUrl: payload.sourceUrl ?? input.url,
    outline: payload.structuralChunks?.map((c) => c.heading).filter((h): h is string => !!h),
    isManualPlacement,
    manualTags: input.manualTags,
    autoTagEnabled: context.userSettings?.auto_tag_enabled ?? true,
    autoClusterEnabled: context.userSettings?.auto_cluster_enabled ?? true,
    summaryLevel: input.summaryLevel,
  };
  const organizerModel = modelFor(deps.models, "auto_organize");
  const organizerModelId = modelIdFor(deps.models, "auto_organize");
  let enrichment: OrganizerResult;
  let enriched = true;
  try {
    enrichment = await organize(organizeInput, context, { model: organizerModel });
  } catch (err) {
    enriched = false;
    warnings.push(`organizer failed: ${errorMessage(err)}`);
    enrichment = fallbackEnrichment(organizeInput, context);
  }

  // Typed items: a client hint (typeHint) or the organizer's suggestion turns a generic note,
  // article or bookmark into movie/book/product/…; fields land in metadata, the folder follows the registry.
  const resolution = resolveItemType({
    payloadType: payload.type,
    typeHint: input.typeHint,
    url: payload.sourceUrl ?? input.url,
    suggestedType: enrichment.suggestedType,
    tags: enrichment.tags,
  });
  const targetType = resolution.extractAs;
  let typed: TypedPayload | null = null;
  if (targetType) {
    try {
      typed = await extractTyped(
        {
          type: targetType,
          text: payload.contentMd,
          url: payload.sourceUrl ?? input.url,
          titleHint: enrichment.title,
          today: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
        },
        { model: modelFor(deps.models, "auto_organize") },
      );
    } catch (err) {
      warnings.push(`typed extraction (${targetType}) failed: ${errorMessage(err)}`);
    }
  }
  const itemType: KnowledgeItemType = typed?.type ?? resolution.directType ?? payload.type;
  const typedFacts = typed ? renderTypedFacts(typed.type, typed.metadata) : "";

  // A mail whose sender address is a known person links to that person ([[Wiki-Link]], backlinks).
  const sender =
    itemType === "email"
      ? senderPerson(payload.metadata.sender ?? payload.metadata.from, context.existingObjects)
      : null;
  const linkedEntities =
    sender && !enrichment.linkedEntities.some((l) => l.objectId === sender.objectId)
      ? [...enrichment.linkedEntities, sender]
      : enrichment.linkedEntities;

  // Adapter tasks (meeting, voice) keep their timestamps; they get the project/goal link by name.
  const taskItems = payload.actionItems
    ? linkTasksToProjects(payload.actionItems, context.existingObjects)
    : enrichment.actionItems;

  // E-mails: the organizer's TL;DR and action items go under the header (no extra model call).
  const baseMd =
    itemType === "email" && enriched
      ? withEmailDigest(payload.contentMd, {
          summary: enrichment.summary,
          actionItems: taskItems,
        })
      : payload.contentMd;
  // Listing pages (front/category pages) are a list of other articles: key points and "Erwähnt"
  // drawn from dozens of headlines are noise, so the clipped list stays as it is.
  const isListingPage = payload.metadata.page_kind === "listing";
  const contentMd = appendMentions(
    appendWikiLinks(
      appendKeyPoints(
        typedFacts ? `${typedFacts}\n\n${baseMd}` : baseMd,
        isListingPage ? [] : enrichment.keyPoints,
      ),
      linkedEntities,
    ),
    isListingPage ? [] : enrichment.mentions,
    linkedEntities,
  );

  // Folder
  const folderPath =
    manualFolderPath ??
    (typed || resolution.directType ? DEFAULT_FOLDER_BY_TYPE[itemType] : enrichment.folderPath) ??
    undefined;
  const folderId = isManualPlacement
    ? input.targetFolderId
    : context.folders?.find((f) => f.folder_path === folderPath)?.id;
  const folderToCreate =
    !isManualPlacement && folderPath && context.folders && !folderId ? folderPath : null;

  // Chunk + embed
  const chunks = chunkDocument(
    {
      title: enrichment.title,
      type: itemType,
      contentMd,
      structuralChunks: payload.structuralChunks,
    },
    deps.chunker,
  );
  let embeddings: number[][] | undefined;
  if (chunks.length > 0) {
    try {
      embeddings = await embedTexts(
        chunks.map((c) => c.text),
        {
          model: deps.models.embedding(),
          batchSize: deps.embedBatchSize,
        },
      );
    } catch (err) {
      warnings.push(`embedding failed: ${errorMessage(err)}`);
    }
  }

  const ingestedAt = (deps.now?.() ?? new Date()).toISOString();
  const item: KnowledgeItemInsert = {
    id: itemId,
    user_id: input.userId,
    type: itemType,
    source_platform: payload.sourcePlatform,
    title: enrichment.title,
    slug: slugify(enrichment.title) || itemId,
    summary: enrichment.summary,
    content_md: contentMd,
    source_url: payload.sourceUrl ?? input.url ?? null,
    file_storage_path: payload.file?.path ?? null,
    file_mime_type: payload.file?.mimeType ?? null,
    file_size_bytes: payload.file?.sizeBytes ?? null,
    cover_image_url: coverUrl,
    icon: ICON_BY_TYPE[itemType] ?? typeIcon(itemType),
    ...(enrichment.clusterName ? { cluster_name: enrichment.clusterName } : {}),
    ...(folderPath ? { folder_path: folderPath } : {}),
    folder_id: folderId ?? null,
    is_manual_placement: isManualPlacement,
    tags: enrichment.tags,
    entities: enrichment.entities,
    related_item_ids: [
      ...new Set(linkedEntities.map((l) => l.objectId).filter((id) => id !== itemId)),
    ],
    metadata: toJson({
      ...payload.metadata,
      ...(typed ? { ...typed.metadata, retyped_from: payload.type } : {}),
      ...(resolution.directType ? { retyped_from: payload.type } : {}),
      ...(resolution.reason && itemType !== payload.type ? { retyped_by: resolution.reason } : {}),
      ...(enrichment.keyPoints.length > 0 ? { key_points: enrichment.keyPoints } : {}),
      ...(input.summaryLevel ? { summary_level: input.summaryLevel } : {}),
      cover_candidates: undefined,
      ...(coverMeta ? { cover: coverMeta } : {}),
      model_used: enriched ? organizerModelId : null,
      // Zero-setup auto-placement: the web app confirms placements below the user's threshold.
      ...(isManualPlacement
        ? {}
        : {
            placement: {
              confidence: enrichment.placementConfidence,
              folder_path: folderPath ?? null,
              source: enriched ? "organizer" : "fallback",
            },
          }),
      ingest: {
        adapter: adapterId,
        ingested_at: ingestedAt,
        embedding_model: embeddings ? modelIdFor(deps.models, "embeddings") : null,
        needs_enrichment: !enriched || undefined,
        needs_embedding: (chunks.length > 0 && !embeddings) || undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    }),
    status: enriched ? "processed" : "inbox",
  };

  // "<provider>:<model_id>" on every embedded chunk: hybrid search only compares the same model.
  const embeddingKey = embeddings ? embeddingModelKeyFor(deps.models) : null;
  return {
    item,
    chunks: chunks.map((c, i) => ({
      item_id: itemId,
      user_id: input.userId,
      chunk_index: c.index,
      chunk_heading: c.heading,
      page_or_timestamp: c.pageOrTimestamp,
      chunk_text: c.text,
      embedding: embeddings?.[i] ? toPgVector(embeddings[i]) : null,
      metadata: toJson({
        token_estimate: c.tokenEstimate,
        ...(embeddings?.[i] && embeddingKey ? { embedding_model: embeddingKey } : {}),
      }),
    })),
    // Specialised adapters (meetings) extract tasks with transcript timestamps; prefer those.
    actionItems: taskItems.map((a) => ({
      user_id: input.userId,
      source_item_id: itemId,
      title: a.title,
      description: a.description,
      assignee: a.assignee,
      priority: a.priority,
      due_date: a.due_date,
      source_timestamp_sec: a.source_timestamp_sec,
      project_item_id: a.project_item_id ?? null,
      timeframe: a.timeframe ?? null,
      context: a.context ?? null,
    })),
    tags: enrichment.tags,
    folderToCreate,
    linkedEntities,
    suggestedObjects: enrichment.suggestedObjects,
    file: payload.file ?? null,
    adapterId,
    skippedAdapters: skipped,
    warnings,
  };
}

// --- Convenience factory for apps/web ---------------------------------------------------------

export interface IngestionPipelineConfig {
  storage: StorageGateway;
  /** Usually `process.env`: ANTHROPIC_API_KEY, OPENROUTER_API_KEY, EDENAI_API_KEY; optional JINA/FIRECRAWL/GROQ/DEEPGRAM overrides. */
  env?: Record<string, string | undefined>;
  /** kortex.user_settings.ai_routing_config (ADR-06); wins over userSettings. */
  routing?: unknown;
  /** Discovered models (kortex.ai_model_catalog) for Auto routing. */
  catalog?: readonly CatalogModel[];
  /** @deprecated Pass `routing`; only `ai_routing_config` is read from here. */
  userSettings?: ModelSettings | null;
  /** Routing warnings (fallback provider, offline list). */
  warn?: (message: string) => void;
  /** Overrides the routed document_parsing (scanned PDFs). */
  documentParser?: DocumentParser;
  fetch?: FetchLike;
  /** Override the model router (tests). Default: createModelRouter over env, routing and catalog. */
  models?: ModelRouter;
  youtube?: DefaultRegistryDeps["youtube"];
  /** Reels/TikTok downloader (desktop/mobile/worker). Default: not implemented, falls back to web-article. */
  socialMedia?: DefaultRegistryDeps["socialMedia"];
  /** Overrides GROQ_API_KEY-based Whisper. */
  audioTranscriber?: DefaultRegistryDeps["audioTranscriber"];
  /** Overrides PODCASTINDEX_API_KEY/SECRET and DEEPGRAM_API_KEY wiring. */
  podcast?: DefaultRegistryDeps["podcast"];
  meeting?: DefaultRegistryDeps["meeting"];
  /** Verify, download and store covers (default on). */
  covers?: boolean;
}

export interface IngestionPipeline {
  readonly registry: IngestionRegistry;
  readonly models: ModelRouter;
  ingest(input: RawIngestInput, context: IngestContext): Promise<IngestResult>;
}

export function createIngestionPipeline(config: IngestionPipelineConfig): IngestionPipeline {
  const env = config.env ?? {};
  const models =
    config.models ??
    createModelRouter({
      env,
      routing: config.routing ?? config.userSettings?.ai_routing_config,
      catalog: config.catalog,
      fetch: config.fetch,
      warn: config.warn,
    });
  // ADR-06: audio_transcription is routed (Eden AI by default). Direct GROQ/DEEPGRAM keys stay
  // optional overrides and win when set.
  const routedTranscriber = models.transcriber?.();
  const groq = env.GROQ_API_KEY
    ? createGroqWhisperTranscriber({ apiKey: env.GROQ_API_KEY, fetch: config.fetch })
    : undefined;
  const audioTranscriber = config.audioTranscriber ?? groq ?? routedTranscriber;
  const podcastIndex =
    config.podcast?.podcastIndex ??
    (env.PODCASTINDEX_API_KEY && env.PODCASTINDEX_API_SECRET
      ? createPodcastIndexClient({
          apiKey: env.PODCASTINDEX_API_KEY,
          apiSecret: env.PODCASTINDEX_API_SECRET,
          fetch: config.fetch,
        })
      : undefined);
  // Podcasts: Deepgram transcribes by URL (no size limit); Groq needs a download (<= 25 MB).
  const podcastTranscriber =
    config.podcast?.transcriber ??
    (env.DEEPGRAM_API_KEY
      ? createDeepgramUrlTranscriber({
          apiKey: env.DEEPGRAM_API_KEY,
          fetch: config.fetch,
          ...(env.DEEPGRAM_MODEL ? { model: env.DEEPGRAM_MODEL } : {}),
        })
      : groq
        ? downloadThenTranscribe(groq, { fetch: config.fetch })
        : config.audioTranscriber
          ? downloadThenTranscribe(config.audioTranscriber, { fetch: config.fetch })
          : routedTranscriber);
  const registry = createDefaultRegistry({
    storage: config.storage,
    models,
    fetch: config.fetch,
    jinaApiKey: env.JINA_API_KEY,
    firecrawlApiKey: env.FIRECRAWL_API_KEY,
    keylessReader: !/^(off|false|0|no)$/i.test(env.KORTEX_KEYLESS_READER ?? ""),
    omdbApiKey: env.OMDB_API_KEY,
    youtube: config.youtube,
    audioTranscriber,
    documentParser: config.documentParser ?? models.documentParser?.(),
    socialMedia: config.socialMedia,
    podcast: {
      podcastIndex,
      transcriber: podcastTranscriber,
      language: config.podcast?.language,
      beforeTranscribe: config.podcast?.beforeTranscribe,
    },
    meeting:
      config.meeting ??
      (env.KORTEX_SELF_NAME ? { speakerNames: { self: env.KORTEX_SELF_NAME } } : undefined),
    inboundMailDomain: env.KORTEX_INBOUND_MAIL_DOMAIN,
  });
  return {
    registry,
    models,
    ingest: (input, context) =>
      ingest(input, context, {
        registry,
        models,
        ...(config.covers === false
          ? {}
          : {
              covers: { storage: config.storage, ...(config.fetch ? { fetch: config.fetch } : {}) },
            }),
      }),
  };
}
