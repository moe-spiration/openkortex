import { slugify, type RawIngestInput } from "@kortex/ai-core";
import type { KnowledgeItemType, Row } from "@kortex/db";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import {
  bumpTags,
  ensureFolderPath,
  getItem,
  getUserSettings,
  loadOrganizerContext,
  mergeJson,
  replaceChunks,
  replaceOpenActionItems,
  updateItem,
} from "../repo";
import { createSupabaseStorageGateway } from "../storage";
import { mergeEnrichedDuplicate } from "./enrich-dedup";
import { createMediaGuard, sttPricePerSecond } from "./media-guard";
import { ORGANIZER_ROUTING_GUIDE } from "./routing-guide";

export interface ProcessOptions {
  /** User's own note from the clipper; goes above the extracted content. */
  userNote?: string | null;
  /** Keep the client's title (chat exports, titled notes) instead of the organizer's. */
  keepTitle?: boolean;
  /** Dedup URL stored in source_url (the reader's canonical URL goes to metadata). */
  sourceUrl?: string;
  sourcePlatform?: string;
  /**
   * Enrich an item that already has its final Markdown (MCP / agent saves, see ./sweep.ts): only
   * summary, tags, entities, chunks and (unless placed by hand) the folder are written. Title, slug,
   * type, content_md, source fields and the item's own metadata keys stay; no tasks are created.
   */
  enrichOnly?: boolean;
  /**
   * Text processed instead when the URL cannot be read on the last attempt (import re-crawl:
   * the export's card), so a dead link keeps its imported content instead of ending in error.
   */
  fallbackText?: string;
  /** Keep the item's type and folder (import re-crawl of a domain object's page). */
  keepType?: boolean;
}

/**
 * Background phase: run the @kortex/ai-core pipeline for an accepted item and persist
 * knowledge_items, item_chunks, action_items and tags. A failure on the last attempt sets status
 * `error` with the reason in metadata.ingest; earlier attempts keep the item `processing`
 * (state `retrying`) so status polling keeps waiting for the retry.
 */
export async function processItem(
  deps: ServerDeps,
  ctx: AuthContext,
  itemId: string,
  input: Omit<RawIngestInput, "userId" | "itemId">,
  options: ProcessOptions = {},
  attempt: { final: boolean } = { final: true },
): Promise<void> {
  const { client: c, userId } = ctx;
  const current = await getItem(c, userId, itemId, [
    "metadata",
    "title",
    "tags",
    "is_manual_placement",
    "type",
    "folder_id",
    "folder_path",
  ]);
  if (!current) return; // deleted before the job ran
  // No AI key at all (a fresh self-hosted installation): the capture is kept as it was saved.
  // Without this the job would retry and the entry would sit in "AI processing" for good.
  const { anthropicApiKey, openrouterApiKey, edenaiApiKey } = deps.env;
  if (!anthropicApiKey && !openrouterApiKey && !edenaiApiKey) {
    await updateItem(c, userId, itemId, {
      status: "processed",
      metadata: mergeJson(current.metadata, {
        ingest: { state: "skipped", reason: "no_ai_key", finished_at: deps.now().toISOString() },
      }),
    });
    deps.log.info(`ingest ${itemId}: no AI key configured, saved without AI processing`);
    return;
  }
  await updateItem(c, userId, itemId, {
    status: "processing",
    metadata: mergeJson(current.metadata, {
      ingest: { state: "processing", started_at: deps.now().toISOString() },
    }),
  });

  try {
    const settings = await getUserSettings(c, userId);
    const context = {
      ...(await loadOrganizerContext(c, userId, settings)),
      routingGuide: ORGANIZER_ROUTING_GUIDE,
    };
    // Shared resolver: pins the embedding model on the first ingest, so web, md-sync and MCP
    // always write (and search) the same vector space.
    const { models } = await deps.resolveModels({ client: c, userId });
    const beforeTranscribe = createMediaGuard({
      deps,
      userId,
      maxMinutes: settings?.media_max_minutes ?? 90,
      usdPerSec: sttPricePerSecond(models, await deps.loadCatalog()),
    });
    const pipeline = deps.createPipeline({
      storage: createSupabaseStorageGateway(c),
      models,
      beforeTranscribe,
    });
    let result;
    let usedFallback = false;
    try {
      result = await pipeline.ingest({ ...input, userId, itemId }, context);
    } catch (err) {
      // Re-crawl of an import: the page is gone or unreadable → keep the export's own text.
      if (!attempt.final || !input.url || !options.fallbackText?.trim()) throw err;
      deps.log.info(`ingest ${itemId}: re-crawl failed, using the imported text`, String(err));
      const { url: _url, clientHint: _hint, ...rest } = input;
      void _url;
      void _hint;
      result = await pipeline.ingest(
        {
          ...rest,
          rawText: options.fallbackText,
          ...(current.type ? { typeHint: current.type as KnowledgeItemType } : {}),
          userId,
          itemId,
        },
        context,
      );
      usedFallback = true;
    }
    if (options.enrichOnly) {
      await applyEnrichment(deps, ctx, itemId, current, result);
      return;
    }

    // S16: an enriched film/book whose IMDb id / ISBN already exists is merged, not duplicated.
    if (await mergeEnrichedDuplicate(c, userId, itemId, result.item)) return;

    let folderId = result.item.folder_id ?? null;
    let folderPath = result.item.folder_path;
    if (options.keepType) {
      folderId = current.folder_id ?? null;
      folderPath = current.folder_path || folderPath;
    } else if (result.folderToCreate && !result.item.is_manual_placement) {
      const folder = await ensureFolderPath(c, userId, result.folderToCreate);
      folderId = folder.id;
      folderPath = folder.folder_path;
    }

    // id/user_id never change; the rest of the pipeline row replaces the optimistic one.
    const { id: _id, user_id: _userId, ...fields } = result.item;
    void _id;
    void _userId;
    const pipelineMeta = (fields.metadata ?? {}) as Record<string, unknown>;
    const tags = [...new Set([...(current.tags ?? []), ...result.tags])];
    const title = options.keepTitle ? current.title : fields.title;

    await updateItem(c, userId, itemId, {
      ...fields,
      title,
      slug: options.keepTitle ? slugify(current.title) || fields.slug : fields.slug,
      ...(options.keepType && current.type ? { type: current.type } : {}),
      content_md: options.userNote
        ? `${options.userNote}\n\n---\n\n${fields.content_md ?? ""}`
        : fields.content_md,
      source_url: options.sourceUrl ?? fields.source_url,
      source_platform: options.sourcePlatform ?? fields.source_platform,
      folder_id: folderId,
      ...(folderPath ? { folder_path: folderPath } : {}),
      tags,
      metadata: mergeJson(current.metadata, {
        ...pipelineMeta,
        canonical_url: fields.source_url ?? null,
        ai_title: options.keepTitle ? fields.title : undefined,
        ...(options.fallbackText !== undefined
          ? { recrawl: { state: usedFallback ? "failed" : "done", url: input.url ?? null } }
          : {}),
        ingest: {
          ...(pipelineMeta.ingest as object | undefined),
          state: "done",
          finished_at: deps.now().toISOString(),
        },
      }),
    });
    await replaceChunks(c, userId, itemId, result.chunks);
    await replaceOpenActionItems(c, userId, itemId, result.actionItems);
    await bumpTags(c, userId, tags);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (attempt.final) await markItemFailed(deps, ctx, itemId, message).catch(() => {});
    else
      await updateItem(c, userId, itemId, {
        status: "processing",
        metadata: mergeJson(current.metadata, {
          ingest: {
            state: "retrying",
            last_error: message.slice(0, 500),
            retry_at: deps.now().toISOString(),
          },
        }),
      }).catch(() => {});
    throw err;
  }
}

type ItemRow = Row<"knowledge_items">;
type PipelineResult = Awaited<ReturnType<ReturnType<ServerDeps["createPipeline"]>["ingest"]>>;

/** `enrichOnly`: AI fields on top of an item whose content, title and type are final. */
async function applyEnrichment(
  deps: ServerDeps,
  ctx: AuthContext,
  itemId: string,
  current: {
    metadata: ItemRow["metadata"];
    tags: ItemRow["tags"];
    is_manual_placement: boolean | null;
  },
  result: PipelineResult,
): Promise<void> {
  const { client: c, userId } = ctx;
  const out = result.item;
  const meta = (out.metadata ?? {}) as Record<string, unknown>;
  const manual = !!current.is_manual_placement;
  const tags = [...new Set([...(current.tags ?? []), ...result.tags])];
  let folder: { folder_id: string | null; folder_path?: string } | null = null;
  if (!manual) {
    folder = {
      folder_id: out.folder_id ?? null,
      ...(out.folder_path ? { folder_path: out.folder_path } : {}),
    };
    if (result.folderToCreate) {
      const f = await ensureFolderPath(c, userId, result.folderToCreate);
      folder = { folder_id: f.id, folder_path: f.folder_path };
    }
  }
  await updateItem(c, userId, itemId, {
    summary: out.summary ?? null,
    tags,
    entities: out.entities ?? [],
    related_item_ids: out.related_item_ids ?? [],
    status: out.status,
    ...(folder ?? {}),
    ...(!manual && out.cluster_name ? { cluster_name: out.cluster_name } : {}),
    // The item's own metadata (goal status, agent fields …) wins over what the adapter guessed.
    metadata: mergeJson(current.metadata, {
      ai_title: out.title,
      ...(meta.key_points ? { key_points: meta.key_points } : {}),
      ...(!manual && meta.placement ? { placement: meta.placement } : {}),
      model_used: meta.model_used ?? null,
      ingest: {
        ...(meta.ingest as object | undefined),
        source: "sweep",
        state: "done",
        finished_at: deps.now().toISOString(),
      },
    }),
  });
  await replaceChunks(c, userId, itemId, result.chunks);
  await bumpTags(c, userId, tags);
}

/** Final failure of an ingest: status `error`, reason in metadata.ingest.error. */
export async function markItemFailed(
  deps: ServerDeps,
  ctx: AuthContext,
  itemId: string,
  message: string,
): Promise<void> {
  const current = await getItem(ctx.client, ctx.userId, itemId, ["metadata", "status"]);
  if (!current || current.status === "error") return;
  await updateItem(ctx.client, ctx.userId, itemId, {
    status: "error",
    metadata: mergeJson(current.metadata, {
      ingest: { state: "error", error: message.slice(0, 500), failed_at: deps.now().toISOString() },
    }),
  });
}
