import { byLocale, ph } from "../i18n";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { errorMessage } from "../errors";
import { defaultFetch, requestJson, type FetchLike } from "../http";
import type { ExtractedPayload, IngestionAdapter } from "../adapters/base-adapter";
import { findImdbId, normalizeIsbn } from "./external-ids";

/*
 * S16: optional enrichment of films/series (OMDb by IMDb id; one routed LLM extraction without a
 * key) and books (Open Library by ISBN, no key). It runs after a typed adapter and never fails the
 * ingest: every problem becomes a `metadata.warnings` entry. Idempotent: an item that already has
 * `metadata.enrichment.source` is left alone unless `force` is set. Only gaps are filled; what the
 * adapter read from the page itself stays.
 */

const ID = "enrich";
export const ENRICH_TIMEOUT_MS = 8_000;
const OMDB = "https://www.omdbapi.com/";
const OPEN_LIBRARY = "https://openlibrary.org";

export type EnrichmentSource = "omdb" | "openlibrary" | "llm";
export interface EnrichmentInfo {
  source: EnrichmentSource;
  /** 1 = looked up by id, lower = matched by title (or proposed by the model): review it. */
  confidence: number;
  at: string;
}

export interface EnrichOptions {
  fetch?: FetchLike;
  /** OMDB_API_KEY (optional). Without it films fall back to the model. */
  omdbApiKey?: string;
  /** Routed cheap text model for the no-key film fallback. */
  model?: () => LanguageModel;
  now?: () => Date;
  timeoutMs?: number;
  /** Re-run although `metadata.enrichment.source` is set. */
  force?: boolean;
}

type Meta = Record<string, unknown>;
interface Result {
  info?: EnrichmentInfo;
  cover?: string;
}

const s = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() && v.trim() !== "N/A" ? v.trim() : undefined;
const has = (m: Meta, k: string) => {
  const v = m[k];
  return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
};
const setGap = (m: Meta, k: string, v: unknown) => {
  if (v !== undefined && v !== null && !has(m, k)) m[k] = v;
};
const yearOf = (v: unknown): number | undefined => {
  const y = Number(String(v ?? "").match(/\d{4}/)?.[0]);
  return y >= 1880 && y <= 2200 ? y : undefined;
};
const csv = (v: unknown): string[] | undefined => {
  const out = (typeof v === "string" ? v.split(",") : [])
    .map((x) => x.trim())
    .filter((x) => x && x !== "N/A");
  return out.length ? out.slice(0, 10) : undefined;
};

// --- OMDb ---------------------------------------------------------------------------------

interface OmdbRecord {
  Response?: string;
  Title?: string;
  Year?: string;
  Genre?: string;
  Director?: string;
  Actors?: string;
  Runtime?: string;
  Plot?: string;
  Poster?: string;
  imdbRating?: string;
  imdbVotes?: string;
  imdbID?: string;
  Type?: string;
  Search?: { imdbID?: string }[];
}

async function omdb(o: EnrichOptions, params: Record<string, string>): Promise<OmdbRecord | null> {
  const q = new URLSearchParams({ ...params, apikey: o.omdbApiKey as string });
  const res = await requestJson<OmdbRecord>(o.fetch ?? defaultFetch, ID, `${OMDB}?${q}`, {
    timeoutMs: o.timeoutMs ?? ENRICH_TIMEOUT_MS,
  });
  return res.Response === "False" ? null : res;
}

function fillFromOmdb(m: Meta, r: OmdbRecord): string | undefined {
  setGap(m, "year", yearOf(r.Year));
  setGap(m, "genres", csv(r.Genre));
  setGap(m, "director", s(r.Director)?.split(",")[0]?.trim());
  setGap(m, "cast", csv(r.Actors));
  const runtime = Number(r.Runtime?.match(/\d+/)?.[0]);
  setGap(m, "runtime_min", runtime > 0 ? runtime : undefined);
  setGap(m, "plot", s(r.Plot));
  const rating = Number(r.imdbRating);
  if (rating > 0)
    setGap(m, "imdb_rating", {
      value: rating,
      count: Number(r.imdbVotes?.replace(/\D/g, "")) || null,
    });
  if (r.Type === "series" || r.Type === "movie") setGap(m, "kind", r.Type);
  return s(r.Poster);
}

const LlmFilm = z.object({
  year: z.number().int().nullable(),
  kind: z.enum(["movie", "series"]).nullable(),
  director: z.string().nullable(),
  genres: z.array(z.string()),
  plot: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

async function enrichMovie(m: Meta, title: string | undefined, o: EnrichOptions): Promise<Result> {
  const at = (o.now?.() ?? new Date()).toISOString();
  let imdb = findImdbId(String(m.imdb_id ?? ""));
  let confidence = 1;

  if (o.omdbApiKey) {
    if (!imdb && title) {
      // Title only: resolve the IMDb id (exact title, then search). It is a guess, so flagged.
      const year = yearOf(m.year);
      const exact = await omdb(o, { t: title, ...(year ? { y: String(year) } : {}) });
      const hit = exact?.imdbID ?? (await omdb(o, { s: title }))?.Search?.[0]?.imdbID;
      imdb = findImdbId(hit ?? "");
      confidence = 0.7;
    }
    if (imdb) {
      const rec = await omdb(o, { i: imdb });
      if (!rec) throw new Error(`omdb: no record for ${imdb}`);
      const cover = fillFromOmdb(m, rec);
      setGap(m, "imdb_id", imdb);
      return { cover, info: { source: "omdb", confidence, at } };
    }
    if (!o.model) throw new Error("omdb: title not found");
  }

  // No key (or title unknown to OMDb): one cheap routed extraction, marked as a proposal.
  if (!o.model || !title) return {};
  if (has(m, "year") && has(m, "director") && has(m, "genres")) return {};
  const { output } = await generateText({
    model: o.model(),
    system: byLocale({
      en:
        "You add metadata for a movie or a series from title and year only. Invent nothing: " +
        "when unsure null or an empty list and a low confidence (0-1). Answer in English.",
      de:
        "Du ergänzt Metadaten zu einem Film oder einer Serie nur aus Titel und Jahr. Erfinde nichts: " +
        "bei Unsicherheit null bzw. leere Liste und niedrige confidence (0-1). Antworte auf Deutsch.",
    }),
    messages: [
      {
        role: "user",
        content: byLocale({
          en: `Title: ${title}${has(m, "year") ? `\nYear: ${m.year}` : ""}`,
          de: `Titel: ${title}${has(m, "year") ? `\nJahr: ${m.year}` : ""}`,
        }),
      },
    ],
    output: Output.object({ schema: LlmFilm, name: "film_enrichment" }),
    temperature: 0,
    abortSignal: AbortSignal.timeout(o.timeoutMs ?? ENRICH_TIMEOUT_MS),
  });
  setGap(m, "year", output.year ? yearOf(output.year) : undefined);
  setGap(m, "kind", output.kind);
  setGap(m, "director", s(output.director));
  setGap(m, "genres", output.genres.length ? output.genres.slice(0, 10) : undefined);
  setGap(m, "plot", s(output.plot));
  return { info: { source: "llm", confidence: Math.round(output.confidence * 100) / 100, at } };
}

// --- Open Library ---------------------------------------------------------------------------

interface OlBook {
  authors?: { name?: string }[];
  publishers?: { name?: string }[];
  publish_date?: string;
  number_of_pages?: number;
  cover?: { large?: string; medium?: string };
}
interface OlSearchDoc {
  author_name?: string[];
  publisher?: string[];
  first_publish_year?: number;
  number_of_pages_median?: number;
  isbn?: string[];
  cover_i?: number;
}

async function enrichBook(m: Meta, title: string | undefined, o: EnrichOptions): Promise<Result> {
  const at = (o.now?.() ?? new Date()).toISOString();
  const opts = { timeoutMs: o.timeoutMs ?? ENRICH_TIMEOUT_MS };
  const f = o.fetch ?? defaultFetch;
  const isbn = normalizeIsbn(typeof m.isbn === "string" ? m.isbn : undefined);

  if (isbn) {
    const key = `ISBN:${isbn}`;
    const res = await requestJson<Record<string, OlBook>>(
      f,
      ID,
      `${OPEN_LIBRARY}/api/books?bibkeys=${key}&format=json&jscmd=data`,
      opts,
    );
    const b = res[key];
    if (!b) throw new Error(`openlibrary: no record for ISBN ${isbn}`);
    setGap(m, "author", s(b.authors?.[0]?.name));
    setGap(m, "publisher", s(b.publishers?.[0]?.name));
    setGap(m, "year", yearOf(b.publish_date));
    setGap(m, "pages", b.number_of_pages && b.number_of_pages > 0 ? b.number_of_pages : undefined);
    return {
      cover: s(b.cover?.large) ?? s(b.cover?.medium),
      info: { source: "openlibrary", confidence: 1, at },
    };
  }

  if (!title) return {};
  const q = new URLSearchParams({
    title,
    limit: "1",
    fields: "author_name,publisher,first_publish_year,number_of_pages_median,isbn,cover_i",
  });
  if (typeof m.author === "string" && m.author) q.set("author", m.author);
  const res = await requestJson<{ docs?: OlSearchDoc[] }>(
    f,
    ID,
    `${OPEN_LIBRARY}/search.json?${q}`,
    opts,
  );
  const d = res.docs?.[0];
  if (!d) throw new Error("openlibrary: title not found");
  setGap(
    m,
    "isbn",
    (d.isbn ?? []).map((i) => normalizeIsbn(i)).find((i): i is string => !!i),
  );
  setGap(m, "author", s(d.author_name?.[0]));
  setGap(m, "publisher", s(d.publisher?.[0]));
  setGap(m, "year", yearOf(d.first_publish_year));
  setGap(m, "pages", d.number_of_pages_median);
  return {
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    info: { source: "openlibrary", confidence: 0.6, at },
  };
}

// --- Entry points -----------------------------------------------------------------------------

const sourceLabel = (source: EnrichmentSource): string =>
  source === "omdb" ? "OMDb" : source === "openlibrary" ? "Open Library" : ph("aiSuggestion");

/** Adds the enrichment to a typed payload (movie, book). Never throws. */
export async function enrichPayload(
  payload: ExtractedPayload,
  options: EnrichOptions,
): Promise<ExtractedPayload> {
  if (payload.type !== "movie" && payload.type !== "book") return payload;
  const current = payload.metadata.enrichment as { source?: unknown } | undefined;
  if (current?.source && !options.force) return payload;

  const meta: Meta = { ...payload.metadata };
  const before = { ...meta };
  const title = s(meta.title) ?? s(payload.titleHint)?.replace(/\s*\(\d{4}[^)]*\)\s*$/, "");
  const warnings = [...((payload.metadata.warnings as string[] | undefined) ?? [])];
  try {
    const r =
      payload.type === "movie"
        ? await enrichMovie(meta, title, options)
        : await enrichBook(meta, title, options);
    if (!r.info) return payload;
    meta.enrichment = r.info;
    const added = Object.keys(meta).filter(
      (k) => k !== "enrichment" && JSON.stringify(meta[k]) !== JSON.stringify(before[k]),
    );
    const conf = r.info.confidence < 1 ? ` (${ph("confidence")} ${r.info.confidence})` : "";
    const note = `*${ph("enriched")}: ${sourceLabel(r.info.source)}${conf}${added.length ? `, ${ph("added")}: ${added.join(", ")}` : ""}*`;
    return {
      ...payload,
      metadata: meta,
      coverImageUrl: payload.coverImageUrl ?? r.cover,
      contentMd: `${payload.contentMd}\n\n---\n${note}`,
    };
  } catch (err) {
    warnings.push(`enrich: ${errorMessage(err)}`);
    return { ...payload, metadata: { ...payload.metadata, warnings } };
  }
}

/** Wraps a typed adapter with the optional enrichment step. */
export function withEnrichment(
  adapter: IngestionAdapter,
  options: EnrichOptions,
): IngestionAdapter {
  return {
    ...adapter,
    extract: async (input) => enrichPayload(await adapter.extract(input), options),
  };
}
