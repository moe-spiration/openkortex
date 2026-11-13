// Zentrales Dedup-Modul: ein Ort für alle Eingänge (Web-Ingest, MCP, md-sync, Importer).
//
// Stufen von `findDuplicate` (erster Treffer gewinnt, nie ein automatischer Treffer ohne harten Schlüssel):
//   1. source_url  normalisierte URL (`source_url_norm`, partiell UNIQUE je Nutzer) bzw. Altbestand über `source_url`
//   2. external_id externe ID laut Typ-Registry (`idKeys`: isbn, imdb_id, message_id) in metadata, gleicher
//                  Typ; exakter Vergleich der normalisierten Form (generierte Spalte `external_ids`)
//   3. content_hash SHA-256 über den normalisierten Text, gleicher Typ (nur ab MIN_HASH_CHARS Zeichen)
//   4. title       Titel-/Entity-Match (`matchKey`) nur für Objekte und Film/Buch/Produkt/Ort, ohne Metadaten-Konflikt
// Semantische Ähnlichkeit (Embeddings) ist nur ein Vorschlag (`suggestSimilar`), nie ein Auto-Merge.
//
// `mergeInto` ergänzt statt zu überschreiben: Titel, Ordner und manuelle Platzierung des bestehenden
// Eintrags bleiben, Tags und Listen werden vereinigt, Quellen in `metadata.sources` vermerkt.

import { t } from "@kortex/i18n";
import type { Insert, KortexClient, Row } from "./client";
import "./i18n";
import { isDomainObjectType } from "./domain";
import { REGISTERED_TYPES, typeIdKeys } from "./type-registry";

// Web-Standard-Globals (Node, Browser, Hermes) lokal deklariert: eine `lib: dom`-Referenz würde in alle
// Pakete durchschlagen, die @kortex/db als Quelle einbinden.
interface UrlLike {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  hash: string;
  searchParams: {
    keys(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
    get(key: string): string | null;
    delete(key: string): void;
  };
  toString(): string;
}
declare const URL: new (input: string) => UrlLike;
interface WebCrypto {
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
}
const webCrypto = () => (globalThis as unknown as { crypto: WebCrypto }).crypto;
const encodeUtf8 = (s: string): Uint8Array =>
  new (
    globalThis as unknown as { TextEncoder: new () => { encode(s: string): Uint8Array } }
  ).TextEncoder().encode(s);
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// --- Normalisierung --------------------------------------------------------------------------

/** Lowercase, umlaut-folded, punctuation-free key for fuzzy equality. */
export const matchKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|igshid|si|ref_src)$/i;

/** Stored form of `source_url`: no fragment, no tracking parameters. Throws on an invalid URL. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  return u.toString();
}

/**
 * Dedup key of a URL (`source_url_norm`): scheme-less, no www/m prefix, sorted query, no trailing
 * slash, YouTube short forms folded. Null for anything that is not an http(s) URL.
 */
export function urlKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: UrlLike;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  if (host === "youtu.be" && segs[0]) return `youtube.com/watch?v=${segs[0]}`;
  if (host === "youtube.com") {
    const id = segs[0] === "shorts" || segs[0] === "embed" ? segs[1] : u.searchParams.get("v");
    if (id) return `youtube.com/watch?v=${id}`;
  }
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length
    ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : "";
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "";
  return `${host}${u.port ? `:${u.port}` : ""}${path}${query}`;
}

/** Text for hashing: NFKC, lowercase, collapsed whitespace. */
export const normalizeText = (s: string): string =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Shorter texts are never hashed ("ok", "todo" would collide). */
export const MIN_HASH_CHARS = 80;

/** A prompt is its text: even a short one identifies itself ("Fasse in 3 Punkten zusammen"). */
export const MIN_PROMPT_HASH_CHARS = 12;

/** Hash threshold per item type. */
export const minHashChars = (type: string): number =>
  type === "prompt" ? MIN_PROMPT_HASH_CHARS : MIN_HASH_CHARS;

/** SHA-256 (hex) over the normalised text; null when the text is too short to identify anything. */
export async function contentHash(
  text: string | null | undefined,
  minChars = MIN_HASH_CHARS,
): Promise<string | null> {
  const norm = normalizeText(text ?? "");
  if (norm.length < minChars) return null;
  return hex(await webCrypto().subtle.digest("SHA-256", encodeUtf8(norm)));
}

export const FILE_HASH_PREFIX = "file:";

/** `content_hash` of an uploaded file: SHA-256 over the raw bytes. */
export async function fileHash(bytes: Uint8Array): Promise<string> {
  return `${FILE_HASH_PREFIX}${hex(await webCrypto().subtle.digest("SHA-256", bytes))}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Comparable form of an external id: trimmed, no whitespace or hyphens, lowercase (ISBN
 * 978-3-16-148410-0 = 9783161484100). Mirrors the generated column `knowledge_items.external_ids`
 * (migration 20261101210000_external_ids.sql).
 */
export function normalizeExternalId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const value = String(raw).trim().replace(/[\s-]/g, "").toLowerCase();
  return value || null;
}

/** Every external-id key of the registry; the `external_ids` column covers exactly these. */
export const EXTERNAL_ID_KEYS: readonly string[] = [
  ...new Set(REGISTERED_TYPES.flatMap((t) => typeIdKeys(t))),
];

/** `key:value` tokens of the generated column `external_ids` (in-memory stand-ins, tests). */
export function externalIdTokens(metadata: unknown): string[] {
  if (!isRecord(metadata)) return [];
  return EXTERNAL_ID_KEYS.flatMap((key) => {
    const value = normalizeExternalId(metadata[key]);
    return value ? [`${key}:${value}`] : [];
  });
}

/** External IDs of a candidate (`isbn`, `imdb_id`, ...) in comparable form. */
export function externalIds(type: string, metadata: unknown): { key: string; value: string }[] {
  if (!isRecord(metadata)) return [];
  const out: { key: string; value: string }[] = [];
  for (const key of typeIdKeys(type)) {
    const value = normalizeExternalId(metadata[key]);
    if (value) out.push({ key, value });
  }
  return out;
}

/** Postgres array literal with quoted elements (`{"isbn:978..."}`) for the PostgREST `cs` filter. */
export const pgTextArray = (values: readonly string[]): string =>
  `{${values.map((v) => `"${v.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;

const idOf = (type: string, metadata: unknown, key: string) =>
  externalIds(type, metadata).find((e) => e.key === key)?.value;

/** Types whose title identifies the entity (the organizer links objects by the same `matchKey`). */
export const isTitleIdentityType = (type: string): boolean =>
  isDomainObjectType(type) || ["movie", "book", "product", "place"].includes(type);

/** Metadata that tells two same-titled entries apart (Dune 1984 vs. 2021, two authors). */
const DISCRIMINATORS = ["year", "author", "director", "isbn", "imdb_id", "location"] as const;

function metadataCompatible(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return true;
  return DISCRIMINATORS.every((k) => {
    const x = a[k];
    const y = b[k];
    if (x === undefined || y === undefined || x === null || y === null || x === "" || y === "")
      return true;
    return matchKey(String(x)) === matchKey(String(y));
  });
}

// --- Kandidat und Schlüssel ------------------------------------------------------------------

export interface DedupCandidate {
  type: string;
  title: string;
  sourceUrl?: string | null;
  contentMd?: string | null;
  metadata?: Record<string, unknown> | null;
  tags?: readonly string[];
  /** source_platform of the incoming capture ("web", "mcp", "vault", ...), noted in `metadata.sources`. */
  platform?: string;
  /** The candidate's own row (updates): never a duplicate of itself. */
  excludeId?: string;
  /**
   * False when the URL does not identify the item (a single AI answer shares the chat's URL): then
   * neither `source_url_norm` is written nor is the URL stage run.
   */
  urlIdentity?: boolean;
  /** Precomputed `content_hash` (files: `fileHash` of the bytes); replaces the text hash. */
  hash?: string | null;
  /** Merge: append differing content as a dated section (default true). */
  appendContent?: boolean;
  /** Capture time for the merge note (default: now). */
  at?: string;
}

export interface DedupKeys {
  source_url_norm: string | null;
  content_hash: string | null;
  externalIds: { key: string; value: string }[];
}

export async function dedupKeys(c: DedupCandidate): Promise<DedupKeys> {
  return {
    source_url_norm: c.urlIdentity === false ? null : urlKey(c.sourceUrl),
    content_hash: c.hash ?? (await contentHash(c.contentMd, minHashChars(c.type))),
    externalIds: externalIds(c.type, c.metadata),
  };
}

/** `source_url_norm` + `content_hash` columns for an insert/update of this candidate. */
export async function dedupColumns(
  c: DedupCandidate,
): Promise<{ source_url_norm: string | null; content_hash: string | null }> {
  const k = await dedupKeys(c);
  return { source_url_norm: k.source_url_norm, content_hash: k.content_hash };
}

// --- Treffer ---------------------------------------------------------------------------------

export type DuplicateReason = "source_url" | "external_id" | "content_hash" | "title";

export const DEDUP_COLUMNS =
  "id,type,title,summary,content_md,source_url,source_url_norm,content_hash,folder_path,folder_id,is_manual_placement,tags,metadata,status";

export type DedupItem = Pick<
  Row<"knowledge_items">,
  | "id"
  | "type"
  | "title"
  | "summary"
  | "content_md"
  | "source_url"
  | "source_url_norm"
  | "content_hash"
  | "folder_path"
  | "folder_id"
  | "is_manual_placement"
  | "tags"
  | "metadata"
  | "status"
>;

export interface DuplicateHit {
  item: DedupItem;
  reason: DuplicateReason;
}

type Stage = DuplicateReason;
const STAGES: readonly Stage[] = ["source_url", "external_id", "content_hash", "title"];

function matches(stage: Stage, item: DedupItem, c: DedupCandidate, k: DedupKeys): boolean {
  if (item.id === c.excludeId) return false;
  switch (stage) {
    case "source_url": {
      if (!k.source_url_norm) return false;
      return (
        item.source_url_norm === k.source_url_norm || urlKey(item.source_url) === k.source_url_norm
      );
    }
    case "external_id":
      return (
        item.type === c.type &&
        k.externalIds.some((e) => idOf(item.type, item.metadata, e.key) === e.value)
      );
    case "content_hash":
      // File hashes identify the upload whatever type the pipeline turned it into.
      return (
        !!k.content_hash &&
        item.content_hash === k.content_hash &&
        (item.type === c.type || k.content_hash.startsWith(FILE_HASH_PREFIX))
      );
    case "title": {
      if (item.type !== c.type || !isTitleIdentityType(c.type)) return false;
      const key = matchKey(c.title);
      return !!key && matchKey(item.title) === key && metadataCompatible(item.metadata, c.metadata);
    }
  }
}

/** Pure matcher over an already loaded list (in-memory repository, tests). Stage order = priority. */
export function findDuplicateIn(
  items: readonly DedupItem[],
  c: DedupCandidate,
  k: DedupKeys,
): DuplicateHit | null {
  for (const stage of STAGES) {
    const item = items.find((i) => matches(stage, i, c, k));
    if (item) return { item, reason: stage };
  }
  return null;
}

interface PgErr {
  code?: string;
  message?: string;
  details?: string;
}

/** The partial unique index on `(user_id, source_url_norm)` was violated. */
export const isSourceUrlConflict = (err: unknown): boolean => {
  const e = err as PgErr | null | undefined;
  return (
    !!e && e.code === "23505" && /source_url_norm/.test(`${e.message ?? ""} ${e.details ?? ""}`)
  );
};

/** PostgREST/Postgres: the filtered column does not exist (migration not applied yet). */
const isMissingColumn = (err: PgErr, column: string): boolean => {
  const text = `${err.message ?? ""} ${err.details ?? ""}`;
  return (
    text.includes(column) &&
    (err.code === "42703" || err.code === "PGRST204" || /does not exist|could not find/i.test(text))
  );
};

const fail = (what: string, error: PgErr): never => {
  throw Object.assign(new Error(`dedup ${what}: ${error.message ?? String(error)}`), {
    code: error.code,
  });
};

/** Looks up the first duplicate of `c` among the user's items (all stages, archived ones included). */
export async function findDuplicate(
  db: KortexClient,
  userId: string,
  c: DedupCandidate,
  keys?: DedupKeys,
): Promise<DuplicateHit | null> {
  const k = keys ?? (await dedupKeys(c));
  const base = () => {
    let q = db.from("knowledge_items").select(DEDUP_COLUMNS).eq("user_id", userId);
    if (c.excludeId) q = q.neq("id", c.excludeId);
    return q.order("created_at", { ascending: true }).limit(5);
  };
  const run = async (q: PromiseLike<{ data: unknown; error: PgErr | null }>) => {
    const { data, error } = await q;
    if (error) fail("lookup", error);
    return (data as DedupItem[] | null) ?? [];
  };

  // Exact match of the normalised id on the generated, GIN-indexed `external_ids` column. Until that
  // migration is applied the column is missing: then the type's items carrying the key are compared
  // in memory (same normalisation, still exact; no ILIKE, so `_`/`%` are never wildcards).
  const byExternalId = async (e: { key: string; value: string }): Promise<DedupItem[]> => {
    const { data, error } = await base()
      .eq("type", c.type)
      // Generated column, not part of the generated client types.
      .filter("external_ids", "cs", pgTextArray([`${e.key}:${e.value}`]));
    if (!error) return (data as DedupItem[] | null) ?? [];
    if (!isMissingColumn(error, "external_ids")) fail("lookup", error);
    let q = db
      .from("knowledge_items")
      .select("id,type,metadata")
      .eq("user_id", userId)
      .eq("type", c.type)
      .not(`metadata->>${e.key}`, "is", null);
    if (c.excludeId) q = q.neq("id", c.excludeId);
    const rows = await run(q.limit(5000));
    const ids = rows
      .filter((r) => idOf(r.type, r.metadata, e.key) === e.value)
      .map((r) => r.id)
      .slice(0, 5);
    return ids.length ? run(base().in("id", ids)) : [];
  };

  const found: DedupItem[] = [];
  if (k.source_url_norm) {
    found.push(...(await run(base().eq("source_url_norm", k.source_url_norm))));
    // Altbestand ohne source_url_norm: die gespeicherte (nur normalisierte) source_url.
    const legacy = [c.sourceUrl, safeNormalize(c.sourceUrl)].filter((u): u is string => !!u);
    if (found.length === 0 && legacy.length)
      found.push(...(await run(base().in("source_url", [...new Set(legacy)]))));
  }
  for (const e of k.externalIds) found.push(...(await byExternalId(e)));
  if (k.content_hash)
    found.push(
      ...(await run(
        k.content_hash.startsWith(FILE_HASH_PREFIX)
          ? base().eq("content_hash", k.content_hash)
          : base().eq("type", c.type).eq("content_hash", k.content_hash),
      )),
    );
  const early = findDuplicateIn(found, c, k);
  if (early) return early;

  if (isTitleIdentityType(c.type) && matchKey(c.title)) {
    let q = db
      .from("knowledge_items")
      .select("id,title")
      .eq("user_id", userId)
      .eq("type", c.type)
      .limit(3000);
    if (c.excludeId) q = q.neq("id", c.excludeId);
    const rows = await run(q);
    const key = matchKey(c.title);
    for (const row of rows.filter((r) => matchKey(r.title) === key)) {
      const full = await run(
        db.from("knowledge_items").select(DEDUP_COLUMNS).eq("id", row.id).eq("user_id", userId),
      );
      const hit = findDuplicateIn(full, c, k);
      if (hit) return hit;
    }
  }
  return null;
}

const safeNormalize = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
};

// --- Merge -----------------------------------------------------------------------------------

export interface SourceNote {
  platform?: string;
  url?: string;
  at: string;
}

/** Patch that merges `c` into `existing`; empty object = nothing to add. */
export interface MergePatch {
  tags?: string[];
  metadata?: Record<string, unknown>;
  content_md?: string;
  summary?: string;
  source_url?: string;
  source_url_norm?: string;
  content_hash?: string | null;
}

const PROTECTED_METADATA = new Set(["ingest", "idempotency_keys", "sources"]);
const MAX_SOURCES = 20;

/** Existing values win; the candidate only fills gaps. Arrays of primitives are united. */
function fillMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (PROTECTED_METADATA.has(key) || value === undefined || value === null) continue;
    const have = out[key];
    if (have === undefined || have === null || have === "") out[key] = value;
    else if (Array.isArray(have) && Array.isArray(value)) {
      const seen = new Set(have.map((v) => JSON.stringify(v)));
      out[key] = [...have, ...value.filter((v) => !seen.has(JSON.stringify(v)))];
    } else if (isRecord(have) && isRecord(value)) out[key] = fillMetadata(have, value);
  }
  return out;
}

/** Union of tags, spelled like the existing ones (hierarchical `a/b` compared by `matchKey`). */
export function unionTags(existing: readonly string[], incoming: readonly string[]): string[] {
  const out = [...existing];
  const seen = new Set(existing.map(matchKey));
  for (const t of incoming) {
    const key = matchKey(t);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/** Existing tag spelling wins: `AI/MCP` becomes `ai/mcp` when that tag already exists. */
export function snapTags(tags: readonly string[], known: readonly string[]): string[] {
  const byKey = new Map(known.map((t) => [matchKey(t), t]));
  return unionTags(
    [],
    tags.map((t) => byKey.get(matchKey(t)) ?? t),
  );
}

/** Pure merge plan: what `mergeInto` writes. Never touches title, folder, type or manual placement. */
export function planMerge(
  existing: DedupItem,
  c: DedupCandidate,
  keys: DedupKeys,
  now = new Date(),
): MergePatch {
  const patch: MergePatch = {};
  const at = (c.at ?? now.toISOString()).slice(0, 10);

  const tags = unionTags(existing.tags ?? [], c.tags ?? []);
  if (tags.length !== (existing.tags ?? []).length) patch.tags = tags;

  const meta0 = isRecord(existing.metadata) ? existing.metadata : {};
  let meta = c.metadata ? fillMetadata(meta0, c.metadata) : { ...meta0 };
  const sources = Array.isArray(meta0.sources) ? (meta0.sources as unknown as SourceNote[]) : [];
  const url = c.sourceUrl ?? undefined;
  if ((url || c.platform) && !sources.some((s) => s.url === url && s.platform === c.platform))
    meta = {
      ...meta,
      sources: [
        ...sources,
        { ...(c.platform ? { platform: c.platform } : {}), ...(url ? { url } : {}), at },
      ].slice(-MAX_SOURCES),
    };
  if (JSON.stringify(meta) !== JSON.stringify(meta0)) patch.metadata = meta;

  const incoming = (c.contentMd ?? "").trim();
  if (incoming) {
    if (!existing.content_md.trim()) patch.content_md = incoming;
    else if (
      c.appendContent !== false &&
      !normalizeText(existing.content_md).includes(normalizeText(incoming))
    )
      {
      // Generated heading in the user's language ("## Addition (…)" / "## Ergänzung (…)"); nothing reads it back.
      const heading = t("Addition ({details})", { details: `${at}${c.platform ? `, ${c.platform}` : ""}` });
      patch.content_md = `${existing.content_md.trimEnd()}\n\n## ${heading}\n\n${incoming}\n`;
    }
  }
  if (!existing.source_url && c.sourceUrl) patch.source_url = c.sourceUrl;
  if (!existing.source_url_norm && keys.source_url_norm)
    patch.source_url_norm = keys.source_url_norm;
  return patch;
}

/** Applies the merge plan. Returns the patch that was written (empty = unchanged). */
export async function mergeInto(
  db: KortexClient,
  userId: string,
  existing: DedupItem,
  c: DedupCandidate,
  keys?: DedupKeys,
): Promise<MergePatch> {
  const k = keys ?? (await dedupKeys(c));
  const patch = planMerge(existing, c, k);
  // The hash always describes the stored body.
  if (patch.content_md !== undefined) patch.content_hash = await contentHash(patch.content_md, minHashChars(existing.type));
  else if (!existing.content_hash) {
    const own = await contentHash(existing.content_md, minHashChars(existing.type));
    if (own) patch.content_hash = own;
  }
  if (Object.keys(patch).length === 0) return patch;
  const update: Record<string, unknown> = { ...patch };
  const write = (u: Record<string, unknown>) =>
    db
      .from("knowledge_items")
      .update(u as never)
      .eq("id", existing.id)
      .eq("user_id", userId);
  let { error } = await write(update);
  if (error && isSourceUrlConflict(error)) {
    // Another row already holds that URL key: merge everything but the key.
    delete update.source_url_norm;
    ({ error } = await write(update));
  }
  if (error) fail("merge", error);
  return patch;
}

// --- Insert mit Merge-Fallback ---------------------------------------------------------------

export interface InsertOrMergeResult {
  /** Id of the stored item: the new row, or the existing one the candidate was merged into. */
  id: string;
  /** Set when the candidate was a duplicate and nothing new was inserted. */
  duplicate: DuplicateHit | null;
}

/**
 * Inserts `row` unless a duplicate exists, in which case the row is merged into it. A concurrent
 * insert that trips `uq_items_user_source_url_norm` is handled as a merge as well, never an error.
 */
export async function insertOrMerge(
  db: KortexClient,
  userId: string,
  row: Insert<"knowledge_items">,
  candidate: DedupCandidate,
): Promise<InsertOrMergeResult> {
  const keys = await dedupKeys(candidate);
  const hit = await findDuplicate(db, userId, candidate, keys);
  if (hit) {
    await mergeInto(db, userId, hit.item, candidate, keys);
    return { id: hit.item.id, duplicate: hit };
  }
  const { error } = await db.from("knowledge_items").insert({
    ...row,
    source_url_norm: row.source_url_norm ?? keys.source_url_norm,
    content_hash: row.content_hash ?? keys.content_hash,
  });
  if (!error) return { id: row.id as string, duplicate: null };
  if (isSourceUrlConflict(error)) {
    const raced = await findDuplicate(db, userId, candidate, keys);
    if (raced) {
      await mergeInto(db, userId, raced.item, candidate, keys);
      return { id: raced.item.id, duplicate: raced };
    }
  }
  return fail("insert", error);
}

// --- Semantische Vorschläge (nie Auto-Merge) ---------------------------------------------------

export interface SimilarSuggestion {
  id: string;
  title: string;
  score: number;
}

/** Near-duplicate hints from a hybrid search; the caller shows them, the user decides. */
export async function suggestSimilar(
  search: (text: string) => Promise<{ id: string; title: string; score: number }[]>,
  c: DedupCandidate,
  opts: { minScore?: number; limit?: number } = {},
): Promise<SimilarSuggestion[]> {
  const text = `${c.title}\n${(c.contentMd ?? "").slice(0, 500)}`.trim();
  if (!text) return [];
  const hits = await search(text);
  return hits
    .filter((h) => h.id !== c.excludeId && h.score >= (opts.minScore ?? 0.85))
    .slice(0, opts.limit ?? 3);
}

// --- Tasks: stabile Identität ------------------------------------------------------------------

export interface ExistingTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  exported_at?: string | null;
  project_item_id?: string | null;
  timeframe?: string | null;
  context?: string | null;
  external_ref?: string | null;
}

export interface TaskSyncPlan<T> {
  insert: T[];
  /** Open, untouched tasks the new extraction no longer contains. */
  deleteIds: string[];
  /** Existing tasks that gain a due date from the new extraction. */
  update: { id: string; due_date: string }[];
}

const taskKey = (title: string) => matchKey(title);

/**
 * Re-extraction of a source item's tasks keeps task identity (`matchKey` of the title): known tasks
 * stay (with all user edits, done state, project/export links), only new ones are inserted. Open tasks
 * the user has not touched and the extraction no longer yields are removed, as before.
 */
export function planTaskSync<T extends { title: string; due_date?: string | null }>(
  existing: readonly ExistingTask[],
  incoming: readonly T[],
): TaskSyncPlan<T> {
  const byKey = new Map<string, ExistingTask>();
  for (const t of existing) if (!byKey.has(taskKey(t.title))) byKey.set(taskKey(t.title), t);
  const seen = new Set<string>();
  const plan: TaskSyncPlan<T> = { insert: [], deleteIds: [], update: [] };
  const kept = new Set<string>();
  for (const row of incoming) {
    const key = taskKey(row.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const have = byKey.get(key);
    if (!have) {
      plan.insert.push(row);
      continue;
    }
    kept.add(have.id);
    if (have.status === "open" && !have.due_date && row.due_date)
      plan.update.push({ id: have.id, due_date: row.due_date });
  }
  for (const t of existing) {
    const touched =
      t.exported_at || t.project_item_id || t.timeframe || t.context || t.external_ref;
    if (t.status === "open" && !kept.has(t.id) && !touched && !seen.has(taskKey(t.title)))
      plan.deleteIds.push(t.id);
  }
  return plan;
}

/**
 * Applies `planTaskSync` to a source item's tasks (web pipeline and md-sync share it). Rows carry
 * `user_id`/`source_item_id` already or get them here.
 */
export async function syncSourceTasks(
  db: KortexClient,
  userId: string,
  itemId: string,
  rows: readonly Insert<"action_items">[],
  /**
   * `prune: false` only adds (on-demand extraction, e.g. the copilot): tasks the new extraction
   * does not contain are kept instead of removed.
   */
  opts: { prune?: boolean } = {},
): Promise<TaskSyncPlan<Insert<"action_items">>> {
  const { data, error } = await db
    .from("action_items")
    .select("id,title,status,due_date,exported_at,project_item_id,timeframe,context,external_ref")
    .eq("user_id", userId)
    .eq("source_item_id", itemId);
  if (error) fail("load tasks", error);
  const plan = planTaskSync((data as ExistingTask[] | null) ?? [], rows);
  if (opts.prune === false) plan.deleteIds = [];
  if (plan.deleteIds.length) {
    const del = await db
      .from("action_items")
      .delete()
      .eq("user_id", userId)
      .in("id", plan.deleteIds);
    if (del.error) fail("delete tasks", del.error);
  }
  for (const u of plan.update) {
    const res = await db
      .from("action_items")
      .update({ due_date: u.due_date })
      .eq("user_id", userId)
      .eq("id", u.id);
    if (res.error) fail("update task", res.error);
  }
  if (plan.insert.length) {
    const ins = await db
      .from("action_items")
      .insert(plan.insert.map((r) => ({ ...r, user_id: userId, source_item_id: itemId })));
    if (ins.error) fail("insert tasks", ins.error);
  }
  return plan;
}

// --- Tasks ohne Quell-Extraktion: offene Aufgabe mit gleichem Titel ------------------------------

/** Task states that count as "open" for duplicate checks. */
export const OPEN_TASK_STATUSES = ["open", "in_progress"] as const;

/** Pure: the oldest open task with the same title (`matchKey`), if any. */
export function findOpenTaskIn<T extends { title: string; status: string }>(
  tasks: readonly T[],
  title: string,
): T | null {
  const key = matchKey(title);
  if (!key) return null;
  return (
    tasks.find(
      (t) =>
        (OPEN_TASK_STATUSES as readonly string[]).includes(t.status) && matchKey(t.title) === key,
    ) ?? null
  );
}

/** The user's oldest open task (open/in_progress) whose title has the same `matchKey`. */
export async function findOpenTaskByTitle(
  db: KortexClient,
  userId: string,
  title: string,
): Promise<{ id: string; title: string; status: string } | null> {
  if (!matchKey(title)) return null;
  const { data, error } = await db
    .from("action_items")
    .select("id,title,status")
    .eq("user_id", userId)
    .in("status", [...OPEN_TASK_STATUSES])
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) fail("load tasks", error);
  return findOpenTaskIn((data as { id: string; title: string; status: string }[] | null) ?? [], title);
}

/**
 * Inserts a single task unless the user already has an open task with the same title; then the
 * existing one is returned (`duplicate: true`) and nothing is written. Done tasks never block.
 */
export async function insertTaskOnce(
  db: KortexClient,
  userId: string,
  row: Insert<"action_items">,
): Promise<{ id: string; duplicate: boolean }> {
  const existing = await findOpenTaskByTitle(db, userId, row.title);
  if (existing) return { id: existing.id, duplicate: true };
  const { data, error } = await db
    .from("action_items")
    .insert({ ...row, user_id: userId })
    .select("id")
    .single();
  if (error) fail("insert task", error);
  return { id: (data as { id: string }).id, duplicate: false };
}
