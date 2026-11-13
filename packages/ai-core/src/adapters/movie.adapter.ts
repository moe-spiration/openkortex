import { acceptLanguage, getLocale, intlLocale, ph, type ContentPhraseKey } from "../i18n";
import { AdapterDeclinedError, errorMessage } from "../errors";
import { defaultFetch, requestText, type FetchLike } from "../http";
import { createSafeFetch } from "../net/safe-fetch";
import { defaultStatusFor } from "../typed/extraction";
import {
  findJsonLdNode,
  formatMinutes,
  isObj,
  isoDurationToMinutes,
  ldImageUrl,
  ldText,
  ldTextList,
  type JsonLd,
} from "../util/json-ld";
import {
  isHttpUrl,
  type ExtractedPayload,
  type IngestionAdapter,
  type RawIngestInput,
} from "./base-adapter";

// Films and series from IMDb (feedback G2). IMDb answers data-center clients with an empty 202 (bot
// wall) but serves link previews in full, so the page is fetched with a link-preview user agent.
// Facts come from schema.org JSON-LD (Movie, TVSeries, …), enriched from the page's __NEXT_DATA__
// (original title, year range, German plot, cast with roles). When the page stays blocked, the title
// and description the client saw ("Clayface (2026) ⭐ 7.6 | Horror", "1h 48m | 16") are parsed.

const ID = "movie";
const PREVIEW_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const MOVIE_TYPES = ["Movie", "TVSeries", "TVMiniSeries", "TVEpisode", "TVMovie", "TVSpecial"];
const MAX_CAST = 10;

export type MovieKind = "movie" | "series" | "episode";

export interface MovieCastMember {
  name: string;
  character?: string;
}

export interface MovieData {
  kind: MovieKind;
  title: string;
  originalTitle?: string;
  year?: number;
  endYear?: number;
  runtimeMin?: number;
  genres: string[];
  rating?: { value: number; count: number | null };
  contentRating?: string;
  plot?: string;
  directors: string[];
  writers: string[];
  creators: string[];
  cast: MovieCastMember[];
  countries: string[];
  keywords: string[];
  poster?: string;
  trailerUrl?: string;
  imdbId?: string;
  source: "json-ld" | "client";
}

/** `tt1234567` from an IMDb title URL (also /de/title/…, m.imdb.com). */
export function imdbTitleId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!/(^|\.)imdb\.com$/i.test(u.hostname)) return undefined;
    return u.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(tt\d+)/i)?.[1];
  } catch {
    return undefined;
  }
}

const kindOf = (type: unknown): MovieKind => {
  const t = (Array.isArray(type) ? type : [type]).map(String);
  if (t.includes("TVEpisode")) return "episode";
  if (t.some((x) => x === "TVSeries" || x === "TVMiniSeries")) return "series";
  return "movie";
};

const names = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((p) => ldText(p)).filter(Boolean))].filter(
    (s): s is string => typeof s === "string",
  );

const yearOf = (v: unknown): number | undefined => {
  const m = typeof v === "string" ? v.match(/^(\d{4})/) : null;
  return m?.[1] ? Number(m[1]) : undefined;
};

export function movieFromJsonLd(node: JsonLd): MovieData {
  const rating = isObj(node.aggregateRating) ? node.aggregateRating : undefined;
  const value = Number(rating?.ratingValue);
  const count = Number(rating?.ratingCount);
  const trailer = isObj(node.trailer) ? node.trailer : undefined;
  // IMDb lists companies and people as creators; only people with a name are kept.
  const people = (v: unknown) =>
    names(
      (Array.isArray(v) ? v : v ? [v] : []).filter(
        (p) => !isObj(p) || p["@type"] === undefined || p["@type"] === "Person",
      ),
    );
  return {
    kind: kindOf(node["@type"]),
    title: ldText(node.name) ?? ph("movie"),
    originalTitle: ldText(node.alternateName),
    year: yearOf(node.datePublished),
    runtimeMin: isoDurationToMinutes(node.duration),
    genres: ldTextList(node.genre),
    rating:
      Number.isFinite(value) && value > 0
        ? { value, count: Number.isFinite(count) && count > 0 ? count : null }
        : undefined,
    contentRating: ldText(node.contentRating),
    plot: ldText(node.description),
    directors: people(node.director),
    writers: [],
    creators: people(node.creator),
    cast: people(node.actor).map((name) => ({ name })),
    countries: [],
    keywords:
      typeof node.keywords === "string"
        ? node.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : [],
    poster: ldImageUrl(node.image),
    trailerUrl:
      typeof trailer?.url === "string" && isHttpUrl(trailer.url)
        ? trailer.url
        : typeof trailer?.embedUrl === "string" && isHttpUrl(trailer.embedUrl)
          ? trailer.embedUrl
          : undefined,
    source: "json-ld",
  };
}

// --- __NEXT_DATA__ (optional extras) ------------------------------------------------

type Obj = Record<string, unknown>;
const get = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((cur, k) => (isObj(cur) ? (cur as Obj)[k] : undefined), o);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const regionName = (code: string): string => {
  try {
    return new Intl.DisplayNames([getLocale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** Extras from IMDb's __NEXT_DATA__; every field is optional and the shape may change. */
export function enrichFromNextData(movie: MovieData, html: string): MovieData {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return movie;
  let page: unknown;
  try {
    page = get(JSON.parse(raw), "props", "pageProps");
  } catch {
    return movie;
  }
  const top = get(page, "aboveTheFoldData");
  const main = get(page, "mainColumnData");
  const out = { ...movie };

  const title = str(get(top, "titleText", "text"));
  const original = str(get(top, "originalTitleText", "text"));
  if (title) out.title = title;
  if (original && original !== out.title) out.originalTitle = original;
  else if (out.originalTitle === out.title) out.originalTitle = undefined;
  const year = get(top, "releaseYear", "year");
  const endYear = get(top, "releaseYear", "endYear");
  if (typeof year === "number") out.year = year;
  if (typeof endYear === "number") out.endYear = endYear;
  const seconds = get(top, "runtime", "seconds");
  if (typeof seconds === "number" && seconds > 0) out.runtimeMin = Math.round(seconds / 60);
  const plot = str(get(top, "plot", "plotText", "plainText"));
  if (plot) out.plot = plot;
  const cert = str(get(top, "certificate", "rating"));
  if (cert) out.contentRating = cert;
  const genres = arr(get(top, "genres", "genres"))
    .map((g) => str(get(g, "text")))
    .filter((g): g is string => !!g);
  if (genres.length) out.genres = genres;
  const countries = arr(get(top, "countriesOfOrigin", "countries"))
    .map((c) => str(get(c, "id")))
    .filter((c): c is string => !!c)
    .map(regionName);
  if (countries.length) out.countries = countries;

  // Principal credits: director / writers / creators, grouped by category id.
  for (const group of arr(get(top, "principalCreditsV2"))) {
    const label = `${str(get(group, "grouping", "text")) ?? ""} ${str(get(group, "grouping", "groupingId")) ?? ""}`;
    const people = arr(get(group, "credits"))
      .map((c) => str(get(c, "name", "nameText", "text")))
      .filter((n): n is string => !!n);
    if (!people.length) continue;
    if (/regie|director/i.test(label)) out.directors = people;
    else if (/autor|writer|drehbuch/i.test(label)) out.writers = people;
    else if (/creator|schöpfer|idee/i.test(label)) out.creators = people;
  }

  // Cast with the role they play.
  const cast: MovieCastMember[] = [];
  for (const group of arr(get(main, "castV2"))) {
    for (const credit of arr(get(group, "credits"))) {
      const name = str(get(credit, "name", "nameText", "text"));
      if (!name || cast.some((c) => c.name === name)) continue;
      const roles = arr(get(credit, "creditedRoles", "edges"))
        .flatMap((e) => arr(get(e, "node", "characters", "edges")))
        .map((e) => str(get(e, "node", "name")))
        .filter((r): r is string => !!r);
      cast.push(roles.length ? { name, character: roles.join(" / ") } : { name });
      if (cast.length >= MAX_CAST) break;
    }
  }
  if (cast.length) out.cast = cast;
  return out;
}

// --- Client fallback ------------------------------------------------------------------

/**
 * What the client saw on a blocked page. IMDb titles look like "Clayface (2026) ⭐ 7.6 | Horror,
 * Thriller", "Breaking Bad (TV Series 2008–2013) - IMDb" or "Clayface (2026): Horror auf IMDb";
 * the description like "1h 48m | 16".
 */
export function movieFromClientHint(hint: RawIngestInput["clientHint"]): MovieData | undefined {
  const raw = hint?.title?.trim();
  if (!raw) return undefined;
  const m = raw.match(
    /^(.+?)\s*\((?:(TV[- ]?(?:Mini[- ]?)?Serie[sn]?|TV[- ]Series|Fernsehserie|TV Episode|TV Movie)\s*)?(\d{4})(?:\s*[–-]\s*(\d{4})?)?\)/i,
  );
  if (!m?.[1] || !m[3]) return undefined;
  const after = raw.slice(m[0].length);
  const rating = after.match(/(?:⭐|★)\s*(\d+(?:[.,]\d)?)/)?.[1];
  const genrePart = after.match(/[|:]\s*([^|]+?)(?:\s+(?:auf|on)\s+IMDb)?\s*$/i)?.[1];
  const desc = hint?.description?.trim() ?? "";
  const runtime = desc.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?/i);
  const runtimeMin =
    runtime && (runtime[1] || runtime[2])
      ? Number(runtime[1] ?? 0) * 60 + Number(runtime[2] ?? 0)
      : undefined;
  const cert = desc.split("|")[1]?.trim();
  return {
    kind: m[2] ? (/episode/i.test(m[2]) ? "episode" : "series") : "movie",
    title: m[1].trim(),
    year: Number(m[3]),
    endYear: m[4] ? Number(m[4]) : undefined,
    runtimeMin: runtimeMin || undefined,
    genres: genrePart
      ? genrePart
          .split(",")
          .map((g) => g.trim())
          .filter((g) => g && !/imdb/i.test(g))
      : [],
    rating: rating ? { value: Number(rating.replace(",", ".")), count: null } : undefined,
    contentRating: cert || undefined,
    // A description that is only "1h 48m | 16" is no plot.
    plot: /\|/.test(desc) && desc.length < 40 ? undefined : desc || undefined,
    directors: [],
    writers: [],
    creators: [],
    cast: [],
    countries: [],
    keywords: [],
    poster: hint?.imageUrl ?? undefined,
    source: "client",
  };
}

// --- Markdown ---------------------------------------------------------------------------

const KIND_LABEL: Record<MovieKind, ContentPhraseKey> = {
  movie: "movie",
  series: "series",
  episode: "episode",
};

const yearLabel = (m: MovieData) =>
  m.year === undefined
    ? undefined
    : m.kind === "series"
      ? `${m.year}–${m.endYear ?? ""}`
      : String(m.year);

/** Heading title: "Clayface (2026)", "Breaking Bad (2008–2013)". */
export const movieTitle = (m: MovieData): string =>
  yearLabel(m) ? `${m.title} (${yearLabel(m)})` : m.title;

/** One decimal in the user's notation: "7,6" in German, "7.6" in English. */
const decimal = (n: number) => {
  const s = String(Math.round(n * 10) / 10);
  return getLocale() === "de" ? s.replace(".", ",") : s;
};

export function renderMovieMarkdown(m: MovieData, url: string): string {
  const md: string[] = [`# ${movieTitle(m)}`, ""];
  if (m.plot) md.push(`> ${m.plot.replace(/\s*\n+\s*/g, " ")}`, "");
  const facts = [
    `**${ph("type")}:** ${ph(KIND_LABEL[m.kind])}`,
    m.year !== undefined ? `**${ph("year")}:** ${yearLabel(m)}` : null,
    m.runtimeMin
      ? `**${ph(m.kind === "series" ? "episodeLength" : "runtime")}:** ${formatMinutes(m.runtimeMin)}`
      : null,
    m.contentRating ? `**${ph("certificate")}:** ${m.contentRating}` : null,
    m.rating
      ? `**IMDb:** ${decimal(m.rating.value)}/10${m.rating.count ? ` (${m.rating.count.toLocaleString(intlLocale())} ${ph("votes")})` : ""}`
      : null,
  ].filter(Boolean);
  md.push(facts.join(" · "), "");
  if (m.genres.length) md.push(`**${ph("genre")}:** ${m.genres.join(", ")}`, "");

  const crew = [
    m.originalTitle ? `- **${ph("originalTitle")}:** ${m.originalTitle}` : null,
    m.directors.length ? `- **${ph("director")}:** ${m.directors.join(", ")}` : null,
    m.writers.length ? `- **${ph("writer")}:** ${m.writers.join(", ")}` : null,
    m.creators.length && m.kind !== "movie" ? `- **${ph("creator")}:** ${m.creators.join(", ")}` : null,
    m.countries.length ? `- **${ph("country")}:** ${m.countries.join(", ")}` : null,
  ].filter(Boolean);
  if (crew.length) md.push(`## ${ph("crew")}`, "", ...(crew as string[]), "");

  if (m.cast.length) {
    md.push(`## ${ph("cast")}`, "");
    if (m.cast.some((c) => c.character)) {
      md.push(`| ${ph("actor")} | ${ph("role")} |`, "| --- | --- |");
      for (const c of m.cast) md.push(`| ${c.name} | ${c.character ?? ""} |`);
    } else {
      for (const c of m.cast) md.push(`- ${c.name}`);
    }
    md.push("");
  }
  const links = [
    m.trailerUrl ? `[Trailer](${m.trailerUrl})` : null,
    `${ph("source")}: [IMDb](${url})`,
  ].filter(Boolean);
  md.push(links.join(" · "));
  return md
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Adapter -------------------------------------------------------------------------------

export interface MovieAdapterOptions {
  fetch?: FetchLike;
}

export function createMovieAdapter(options: MovieAdapterOptions = {}): IngestionAdapter {
  const fetchFn = options.fetch ?? defaultFetch;
  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      isHttpUrl(input.url) && !input.fileBuffer && !!imdbTitleId(input.url),

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const url = input.url as string;
      const warnings: string[] = [];
      let movie: MovieData | undefined;
      try {
        const html = await requestText(createSafeFetch({ fetch: fetchFn }), ID, url, {
          headers: {
            "User-Agent": PREVIEW_UA,
            Accept: "text/html",
            "Accept-Language": acceptLanguage(),
          },
        });
        const node = findJsonLdNode(html, MOVIE_TYPES);
        if (node) movie = enrichFromNextData(movieFromJsonLd(node), html);
        else warnings.push("imdb: no Movie JSON-LD on the page (blocked?)");
      } catch (err) {
        warnings.push(`imdb: ${errorMessage(err)}`);
      }
      movie ??= movieFromClientHint(input.clientHint ?? { title: input.title });
      if (!movie) throw new AdapterDeclinedError(ID, warnings.join("; ") || "no film data");
      movie.imdbId = imdbTitleId(url);

      return {
        type: "movie",
        sourcePlatform: "imdb",
        titleHint: movieTitle(movie),
        contentMd: renderMovieMarkdown(movie, url),
        coverImageUrl: movie.poster,
        metadata: {
          // Registry fields (@kortex/db movie schema); the lifecycle starts at the registry default.
          kind: movie.kind === "movie" ? "movie" : "series",
          status: defaultStatusFor("movie"),
          director: movie.directors[0],
          media_kind: movie.kind,
          imdb_id: movie.imdbId ?? null,
          extractor: movie.source,
          title: movie.title,
          original_title: movie.originalTitle ?? null,
          year: movie.year ?? null,
          end_year: movie.endYear ?? null,
          runtime_min: movie.runtimeMin ?? null,
          genres: movie.genres,
          imdb_rating: movie.rating ?? null,
          content_rating: movie.contentRating ?? null,
          directors: movie.directors,
          writers: movie.writers,
          creators: movie.creators,
          cast: movie.cast.map((c) => c.name),
          cast_roles: movie.cast,
          countries: movie.countries,
          keywords: movie.keywords,
          trailer_url: movie.trailerUrl ?? null,
          warnings: warnings.length ? warnings : undefined,
        },
      };
    },
  };
}
