import { byLocale, headingRe, ph, t } from "../i18n";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  DEFAULT_FOLDER_BY_TYPE,
  DOMAIN_OBJECT_TYPES,
  matchKey,
  toPgVector,
  type Json,
  type KnowledgeItemType,
} from "@kortex/db";
import { chunkDocument } from "../enrichment/chunker";
import { embedTexts } from "../enrichment/embeddings";
import { slugify, type ItemChunkInsert } from "../pipeline/ingest";
import { modelFor, type ModelRouter } from "../router/model-router";

/*
 * Re-index of existing items (first use: the Recall import of 2026-11-10). Three passes, all
 * additive and reversible, no organizer re-run:
 *
 *  1. Tool check: imported items that became `tool` objects only because of a source tag
 *     ("Business Software") get one cheap model call. Real software keeps the type and gets its
 *     short product name as title ("Supabase" instead of the page headline) so other items can
 *     link to it; hardware becomes `product`, everything else `article`. The old type and title
 *     stay in metadata.reindex.
 *  2. Relink: every item's stored entity names are matched against the current objects (same
 *     rule as the organizer, linkEntities). New matches go into related_item_ids and the
 *     "## Verknüpft" section. Items processed before an object existed get their links now.
 *  3. Embeddings: items without chunks are chunked from content_md; chunks without a vector of
 *     the pinned model are re-embedded (search, RAG and the graph's semantic edges read those).
 */

export const RETYPE_KINDS = ["tool", "product", "article"] as const;
export type RetypeKind = (typeof RETYPE_KINDS)[number];

export interface ReindexItem {
  id: string;
  type: string;
  title: string;
  content_md: string;
  entities: string[] | null;
  related_item_ids: string[] | null;
  metadata: Json | null;
  status: string;
  source_url: string | null;
  is_manual_placement: boolean | null;
  folder_path: string | null;
}

export interface ChunkRef {
  id: string;
  item_id: string;
  chunk_text: string;
  metadata: Json | null;
}

/** Everything the re-index reads and writes; Supabase in production, in-memory in tests. */
export interface ReindexStore {
  listItems(): Promise<ReindexItem[]>;
  listChunks(): Promise<ChunkRef[]>;
  embeddingKey(): Promise<string | null>;
  folderId(path: string): Promise<string | null>;
  updateItem(id: string, patch: Record<string, unknown>): Promise<void>;
  /** New vectors for existing chunks (id kept). */
  saveVectors(rows: Array<{ id: string; embedding: string; metadata: Json }>): Promise<void>;
  insertChunks(rows: ItemChunkInsert[]): Promise<void>;
}

export interface ToolVerdict {
  kind: RetypeKind;
  /** Short product name for a tool ("Supabase"); null otherwise. */
  name: string | null;
}

export type ToolClassifier = (item: ReindexItem) => Promise<ToolVerdict>;

export interface ReindexOptions {
  store: ReindexStore;
  userId: string;
  /** Items the passes work on: "recall" (default) or every item. Link targets are always all objects. */
  scope?: "recall" | "all";
  dryRun?: boolean;
  /** Needed for the tool pass when not a dry run (one call per candidate). */
  classify?: ToolClassifier;
  /** Needed for the embedding pass when not a dry run. */
  models?: Pick<ModelRouter, "embedding">;
  passes?: { tools?: boolean; links?: boolean; embeddings?: boolean };
  now?: () => Date;
  log?: (message: string) => void;
  /** Wait between embedding requests and before retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export interface ReindexReport {
  scope: "recall" | "all";
  dryRun: boolean;
  items: number;
  notProcessed: Array<{ id: string; title: string; status: string }>;
  tools: {
    candidates: number;
    kept: Array<{ id: string; from: string; to: string }>;
    retyped: Array<{ id: string; title: string; to: RetypeKind }>;
    /** Clean name already taken by another object: the item becomes an article linked to it. */
    collisions: Array<{ id: string; title: string; existing: string }>;
  };
  links: {
    items: number;
    added: number;
    /** Items whose [[links]] still named an object's old title (renamed by the tool pass). */
    repaired: number;
    /** Items whose related_item_ids pointed at themselves (cleaned). */
    selfLinks: number;
    examples: Array<{ title: string; linked: string[] }>;
  };
  embeddings: {
    lock: string | null;
    itemsWithoutChunks: number;
    chunksWithoutVector: number;
    chunked: number;
    reembedded: number;
  };
}

const DOMAIN = new Set<string>(DOMAIN_OBJECT_TYPES);
/** "## Linked" or "## Verknüpft": notes of both languages are read. */
const LINKED_HEADING = headingRe("linked");

const metaOf = (m: Json | null | undefined): Record<string, Json | undefined> =>
  m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, Json | undefined>) : {};

export const isRecallImport = (item: Pick<ReindexItem, "metadata">): boolean =>
  metaOf(metaOf(item.metadata).import as Json).source === "recall";

/** Recall items that are `tool` only because of a source tag (not yet checked by a re-index). */
export function isToolCandidate(item: ReindexItem): boolean {
  if (item.type !== "tool" || !isRecallImport(item)) return false;
  if (metaOf(item.metadata).reindex) return false;
  const tags = metaOf(metaOf(item.metadata).import as Json).recall_tags;
  return Array.isArray(tags) && tags.some((t) => /software/i.test(String(t)));
}

/**
 * Replaces the "## Verknüpft" section (up to the next heading of level 1-2) with `titles`, or
 * appends it. Other sections ("Erwähnt", "Kernpunkte") stay as they are.
 */
export function rewriteLinkedSection(contentMd: string, titles: readonly string[]): string {
  const m = LINKED_HEADING.exec(contentMd);
  if (titles.length === 0 && !m) return contentMd;
  const section =
    titles.length > 0 ? `## ${ph("linked")}\n\n${titles.map((t) => `- [[${t}]]`).join("\n")}\n` : "";
  if (!m) return `${contentMd.trimEnd()}\n\n${section}`;
  const start = m.index;
  const rest = contentMd.slice(start + m[0].length);
  const next = /^#{1,2}\s/m.exec(rest);
  const end = next ? start + m[0].length + next.index : contentMd.length;
  const tail = contentMd.slice(end);
  if (!section) return `${contentMd.slice(0, start).trimEnd()}\n${tail ? `\n${tail}` : ""}`;
  return `${contentMd.slice(0, start)}${section}${tail ? `\n${tail}` : ""}`;
}

/** Titles listed under "## Verknüpft" ([[…]]), in order. */
export function linkedSectionTitles(contentMd: string): string[] {
  const m = LINKED_HEADING.exec(contentMd);
  if (!m) return [];
  const rest = contentMd.slice(m.index + m[0].length);
  const next = /^#{1,2}\s/m.exec(rest);
  const body = next ? rest.slice(0, next.index) : rest;
  // Link target only: `[[Zite | Build software]]` names "Zite" (alias and #heading dropped).
  return [...body.matchAll(/^\s*-\s*\[\[([^\]]+)\]\]/gm)].map((x) =>
    x[1]!.split(/[|#]/)[0]!.trim(),
  );
}

const WIKI_LINK = /\[\[([^\]|#\n]+)((?:[#|][^\]\n]*)?)\]\]/g;

/**
 * Names an item mentions besides its entities: [[wiki-link]] targets anywhere in the body and the
 * plain bullets under "## Erwähnte Ressourcen" (video/podcast notes).
 */
export function mentionedNames(contentMd: string): string[] {
  const out = [...contentMd.matchAll(WIKI_LINK)].map((m) => m[1]!.trim());
  const res = /^## Erwähnte Ressourcen\s*$/m.exec(contentMd);
  if (res) {
    const rest = contentMd.slice(res.index + res[0].length);
    const next = /^#{1,2}\s|^>/m.exec(rest);
    const body = next ? rest.slice(0, next.index) : rest;
    for (const m of body.matchAll(/^\s*[-*]\s+(.+?)\s*$/gm)) {
      const name = m[1]!.replace(/\[\[|\]\]/g, "").trim();
      if (name && name.length <= 80) out.push(name);
    }
  }
  return out;
}

/** Points [[old title]] links (keeping |alias / #heading) at the new title of a renamed object. */
export function renameWikiLinks(contentMd: string, renames: ReadonlyMap<string, string>): string {
  if (renames.size === 0) return contentMd;
  return contentMd.replace(WIKI_LINK, (all, target: string, rest: string) => {
    const to = renames.get(matchKey(target));
    return to ? `[[${to}${rest}]]` : all;
  });
}

/** matchKey(old title) → new title of every object the tool pass renamed. */
export function renamesOf(items: readonly ReindexItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const i of items) {
    const from = metaOf(metaOf(i.metadata).reindex as Json).from_title;
    if (typeof from === "string" && matchKey(from) !== matchKey(i.title))
      map.set(matchKey(from), i.title);
  }
  return map;
}

export interface LinkPlan {
  itemId: string;
  add: string[];
  related: string[];
  linkedTitles: string[];
  /** The stored ids contained the item's own id (dropped). */
  selfLink: boolean;
}

/**
 * New object links per item: entity names (and existing [[links]]) matched by title against the
 * objects, like the organizer's linkEntities. Only additions; nothing is unlinked.
 */
export function planLinks(
  items: readonly ReindexItem[],
  objects: ReadonlyArray<{ id: string; title: string }>,
): LinkPlan[] {
  const index = new Map<string, { id: string; title: string }>();
  for (const o of objects) {
    const k = matchKey(o.title);
    if (k && !index.has(k)) index.set(k, o);
  }
  const byId = new Map(objects.map((o) => [o.id, o]));
  const plans: LinkPlan[] = [];
  for (const item of items) {
    // An item never links to itself (older ingests stored the object's own id).
    const related = (item.related_item_ids ?? []).filter((id) => id !== item.id);
    const selfLink = related.length !== (item.related_item_ids ?? []).length;
    const have = new Set(related);
    const add: string[] = [];
    for (const name of [...(item.entities ?? []), ...mentionedNames(item.content_md)]) {
      const obj = index.get(matchKey(name));
      if (!obj || obj.id === item.id || have.has(obj.id)) continue;
      have.add(obj.id);
      add.push(obj.id);
    }
    // "## Verknüpft" never lists the item itself (objects matched their own old title).
    const ownKey = matchKey(item.title);
    const listed = linkedSectionTitles(item.content_md);
    const shown = listed.filter((t) => matchKey(t) !== ownKey);
    const selfListed = shown.length !== listed.length;
    if (add.length === 0 && !selfLink && !selfListed) continue;
    const all = [...related, ...add];
    // Anything already linked somewhere in the body ("Erwähnt") is not listed a second time.
    const shownKeys = new Set([...item.content_md.matchAll(WIKI_LINK)].map((m) => matchKey(m[1]!)));
    shownKeys.add(ownKey);
    const linkedTitles = [...shown];
    for (const id of all) {
      const t = byId.get(id)?.title;
      if (t && !shownKeys.has(matchKey(t))) {
        shownKeys.add(matchKey(t));
        linkedTitles.push(t);
      }
    }
    plans.push({
      itemId: item.id,
      add,
      related: all,
      linkedTitles,
      selfLink: selfLink || selfListed,
    });
  }
  return plans;
}

const VerdictSchema = z.object({
  kind: z.enum(RETYPE_KINDS),
  name: z.string().nullable(),
});

const CLASSIFY_SYSTEM_EN = [
  "You classify a saved web entry. Answer with the JSON object only.",
  'kind "tool": the page presents ONE piece of software, app, API, platform or SaaS service (product or repo page).',
  'kind "product": a physical device or hardware (monitor, camera, tablet, accessory).',
  'kind "article": everything else: article, news, blog post, study, documentation, tutorial, directory/list of many tools, shop listing.',
  'name: only for "tool" the short product name without a slogan, the way it is written (e.g. "Supabase", "Trigger.dev", "HyperFrames Studio"); otherwise null.',
].join("\n");

const CLASSIFY_SYSTEM_DE = [
  "Du ordnest einen gespeicherten Web-Eintrag ein. Antworte nur mit dem JSON-Objekt.",
  'kind "tool": die Seite stellt EINE Software, App, API, Plattform oder einen SaaS-Dienst vor (Produkt- oder Repo-Seite).',
  'kind "product": ein physisches Gerät oder Hardware (Monitor, Kamera, Tablet, Zubehör).',
  'kind "article": alles andere: Artikel, News, Blogpost, Studie, Doku, Tutorial, Verzeichnis/Liste vieler Tools, Shop-Liste.',
  'name: nur bei "tool" der kurze Produktname ohne Slogan, so wie man ihn schreibt (z. B. "Supabase", "Trigger.dev", "HyperFrames Studio"); sonst null.',
].join("\n");

/** One cheap call (summarize route, cost_efficient) per tool candidate. */
export function createToolClassifier(models: ModelRouter): ToolClassifier {
  return async (item) => {
    const { output } = await generateText({
      model: modelFor(models, "summarize"),
      system: byLocale({ en: CLASSIFY_SYSTEM_EN, de: CLASSIFY_SYSTEM_DE }),
      prompt: byLocale({
        en: [
          `Title: ${item.title}`,
          item.source_url ? `URL: ${item.source_url}` : null,
          `<content>\n${item.content_md.slice(0, 2500)}\n</content>`,
        ],
        de: [
          `Titel: ${item.title}`,
          item.source_url ? `URL: ${item.source_url}` : null,
          `<inhalt>\n${item.content_md.slice(0, 2500)}\n</inhalt>`,
        ],
      })
        .filter(Boolean)
        .join("\n"),
      output: Output.object({ schema: VerdictSchema, name: "verdict" }),
      temperature: 0,
    });
    const name = output.name?.trim().slice(0, 80) || null;
    return { kind: output.kind, name: output.kind === "tool" ? name : null };
  };
}

/** Texts per embedding request in the re-index (small: providers meter tokens per minute). */
export const REINDEX_EMBED_BATCH = 16;
const PAUSE_MS = 1000;
const MAX_TRIES = 8;

/** Provider rate limit or token quota (HTTP 429), worth waiting for. */
export function isRateLimit(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string; lastError?: unknown } | null;
  if (e?.statusCode === 429) return true;
  if (e?.lastError && isRateLimit(e.lastError)) return true;
  return /429|rate.?limit|quota|too many requests/i.test(String(e?.message ?? err));
}

/**
 * Embeds in small sequential batches with a pause in between; a rate limit or token quota waits
 * and retries (5 s, 10 s, 20 s … up to 2 min) instead of failing the whole run.
 */
async function* embedThrottled(
  texts: readonly string[],
  model: ReturnType<ModelRouter["embedding"]>,
  sleep: (ms: number) => Promise<void>,
  log: (m: string) => void,
): AsyncGenerator<{ from: number; vectors: number[][] }> {
  for (let from = 0; from < texts.length; from += REINDEX_EMBED_BATCH) {
    const batch = texts.slice(from, from + REINDEX_EMBED_BATCH);
    for (let attempt = 1; ; attempt++) {
      try {
        const vectors = await embedTexts(batch, {
          model,
          batchSize: batch.length,
          maxParallelBatches: 1,
        });
        yield { from, vectors };
        break;
      } catch (err) {
        if (!isRateLimit(err) || attempt >= MAX_TRIES) throw err;
        const wait = Math.min(5000 * 2 ** (attempt - 1), 120_000);
        log(
          t("Embeddings: rate limit, waiting {seconds} s (attempt {attempt}/{max})", {
            seconds: Math.round(wait / 1000),
            attempt,
            max: MAX_TRIES,
          }),
        );
        await sleep(wait);
      }
    }
    if (from + REINDEX_EMBED_BATCH < texts.length) await sleep(PAUSE_MS);
  }
}

export async function runReindex(opts: ReindexOptions): Promise<ReindexReport> {
  const { store } = opts;
  const scope = opts.scope ?? "recall";
  const dryRun = opts.dryRun ?? true;
  const passes = { tools: true, links: true, embeddings: true, ...opts.passes };
  const log = opts.log ?? (() => {});
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let all = await store.listItems();
  const inScope = () => all.filter((i) => scope === "all" || isRecallImport(i));
  const report: ReindexReport = {
    scope,
    dryRun,
    items: inScope().length,
    notProcessed: inScope()
      .filter((i) => i.status !== "processed")
      .map((i) => ({ id: i.id, title: i.title, status: i.status })),
    tools: { candidates: 0, kept: [], retyped: [], collisions: [] },
    links: { items: 0, added: 0, repaired: 0, selfLinks: 0, examples: [] },
    embeddings: {
      lock: null,
      itemsWithoutChunks: 0,
      chunksWithoutVector: 0,
      chunked: 0,
      reembedded: 0,
    },
  };
  log(
    t("{items} entries in scope ({scope}), {open} not fully processed", {
      items: report.items,
      scope,
      open: report.notProcessed.length,
    }),
  );

  // 1. Tool check
  if (passes.tools) {
    const candidates = inScope().filter(isToolCandidate);
    report.tools.candidates = candidates.length;
    log(t("Tool check: {n} candidates", { n: candidates.length }));
    if (!dryRun && candidates.length > 0) {
      if (!opts.classify) throw new Error("reindex: tool pass needs a classifier");
      const taken = new Map<string, string>(); // matchKey(title) → id of other objects
      for (const o of all)
        if (DOMAIN.has(o.type) && !candidates.some((c) => c.id === o.id))
          taken.set(`${o.type}:${matchKey(o.title)}`, o.title);
      for (const item of candidates) {
        const verdict = await opts.classify(item);
        const prev = { from_type: item.type, from_title: item.title, at: now, by: "reindex" };
        let kind = verdict.kind;
        let name = verdict.name;
        if (kind === "tool" && name) {
          const key = `tool:${matchKey(name)}`;
          const existing = taken.get(key);
          if (existing) {
            report.tools.collisions.push({ id: item.id, title: item.title, existing });
            kind = "article";
            name = null;
          } else taken.set(key, name);
        }
        const patch: Record<string, unknown> = {
          metadata: { ...metaOf(item.metadata), reindex: prev } as Json,
        };
        if (kind === "tool") {
          const title = name ?? item.title;
          if (title !== item.title) {
            Object.assign(patch, { title, slug: slugify(title) || item.id });
            (patch.metadata as Record<string, Json>).ai_title = item.title;
          }
          report.tools.kept.push({ id: item.id, from: item.title, to: title });
        } else {
          const folder = DEFAULT_FOLDER_BY_TYPE[kind as KnowledgeItemType];
          Object.assign(patch, { type: kind });
          if (!item.is_manual_placement && folder)
            Object.assign(patch, { folder_path: folder, folder_id: await store.folderId(folder) });
          report.tools.retyped.push({ id: item.id, title: item.title, to: kind });
        }
        await store.updateItem(item.id, patch);
      }
      log(
        t("Tool check: {kept} stay a tool, {retyped} retyped, {collisions} duplicate names", {
          kept: report.tools.kept.length,
          retyped: report.tools.retyped.length,
          collisions: report.tools.collisions.length,
        }),
      );
      all = await store.listItems();
    }
  }

  // 2. Relink
  if (passes.links) {
    // Links to a renamed object still carry its old title: repair them in every item.
    const renames = renamesOf(all);
    const content = new Map<string, string>();
    for (const i of all) {
      const md = renameWikiLinks(i.content_md, renames);
      if (md !== i.content_md) {
        content.set(i.id, md);
        i.content_md = md;
      }
    }
    report.links.repaired = content.size;
    const objects = all
      .filter((i) => DOMAIN.has(i.type))
      .map((o) => ({ id: o.id, title: o.title }));
    const plans = planLinks(inScope(), objects);
    report.links.items = plans.filter((p) => p.add.length > 0).length;
    report.links.added = plans.reduce((n, p) => n + p.add.length, 0);
    report.links.selfLinks = plans.filter((p) => p.selfLink).length;
    const byId = new Map(all.map((i) => [i.id, i]));
    const titleOf = new Map(objects.map((o) => [o.id, o.title]));
    report.links.examples = plans
      .filter((p) => p.add.length > 0)
      .slice(0, 10)
      .map((p) => ({
        title: byId.get(p.itemId)?.title ?? p.itemId,
        linked: p.add.map((id) => titleOf.get(id) ?? id),
      }));
    log(
      t(
        "Linking: {repaired} entries with renamed links repaired, {added} new links in {items} entries, {selfLinks} self-links removed",
        {
          repaired: report.links.repaired,
          added: report.links.added,
          items: report.links.items,
          selfLinks: report.links.selfLinks,
        },
      ),
    );
    if (!dryRun) {
      const related = new Map<string, string[]>();
      for (const p of plans) {
        const item = byId.get(p.itemId)!;
        content.set(p.itemId, rewriteLinkedSection(item.content_md, p.linkedTitles));
        related.set(p.itemId, p.related);
      }
      for (const [id, md] of content)
        await store.updateItem(id, {
          content_md: md,
          ...(related.has(id) ? { related_item_ids: related.get(id) } : {}),
        });
    }
  }

  // 3. Embeddings
  if (passes.embeddings) {
    const lock = await store.embeddingKey();
    report.embeddings.lock = lock;
    const items = inScope().filter((i) => i.status === "processed");
    const ids = new Set(items.map((i) => i.id));
    const chunks = (await store.listChunks()).filter((c) => ids.has(c.item_id));
    const withChunks = new Set(chunks.map((c) => c.item_id));
    const empty = items.filter((i) => !withChunks.has(i.id) && i.content_md.trim());
    const stale = lock ? chunks.filter((c) => metaOf(c.metadata).embedding_model !== lock) : [];
    report.embeddings.itemsWithoutChunks = empty.length;
    report.embeddings.chunksWithoutVector = stale.length;
    log(
      t("Embeddings ({lock}): {empty} entries without chunks, {stale} chunks without a matching vector", {
        lock: lock ?? t("no lock"),
        empty: empty.length,
        stale: stale.length,
      }),
    );
    if (!dryRun && (empty.length > 0 || stale.length > 0)) {
      if (!lock) throw new Error("reindex: no embedding model pinned yet (embedding_lock)");
      if (!opts.models) throw new Error("reindex: embedding pass needs a model router");
      const model = opts.models.embedding();
      for await (const { from, vectors } of embedThrottled(
        stale.map((r) => r.chunk_text),
        model,
        sleep,
        log,
      )) {
        const rows = stale.slice(from, from + vectors.length);
        await store.saveVectors(
          rows.map((r, j) => ({
            id: r.id,
            embedding: toPgVector(vectors[j]!),
            metadata: { ...metaOf(r.metadata), embedding_model: lock } as Json,
          })),
        );
        report.embeddings.reembedded += rows.length;
        log(`  ${report.embeddings.reembedded}/${stale.length} Chunks`);
      }
      for (const item of empty) {
        const parts = chunkDocument({
          title: item.title,
          type: item.type,
          contentMd: item.content_md,
        });
        if (parts.length === 0) continue;
        const vectors: number[][] = [];
        for await (const b of embedThrottled(
          parts.map((c) => c.text),
          model,
          sleep,
          log,
        ))
          vectors.push(...b.vectors);
        await store.insertChunks(
          parts.map((c, j) => ({
            item_id: item.id,
            user_id: opts.userId,
            chunk_index: c.index,
            chunk_heading: c.heading,
            page_or_timestamp: c.pageOrTimestamp,
            chunk_text: c.text,
            embedding: toPgVector(vectors[j]!),
            metadata: { token_estimate: c.tokenEstimate, embedding_model: lock } as Json,
          })),
        );
        report.embeddings.chunked++;
      }
      log(
        t("Embeddings: {reembedded} chunks renewed, {chunked} entries chunked", {
          reembedded: report.embeddings.reembedded,
          chunked: report.embeddings.chunked,
        }),
      );
    }
  }
  return report;
}
