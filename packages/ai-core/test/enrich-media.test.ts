import { describe, expect, it } from "vitest";
import { enrichPayload, withEnrichment } from "../src/typed/enrich-media";
import type { ExtractedPayload, IngestionAdapter } from "../src/adapters/base-adapter";
import { fakeFetch, json, mockModel, USER_ID } from "./helpers";

// S16: optional enrichment of films (OMDb / LLM fallback) and books (Open Library).
const NOW = () => new Date("2026-11-01T10:00:00Z");

const movie = (metadata: Record<string, unknown> = {}): ExtractedPayload => ({
  type: "movie",
  sourcePlatform: "imdb",
  titleHint: "Matrix",
  contentMd: "# Matrix",
  metadata: { imdb_id: "tt0133093", ...metadata },
});
const book = (metadata: Record<string, unknown> = {}): ExtractedPayload => ({
  type: "book",
  sourcePlatform: "manual",
  titleHint: "Dune",
  contentMd: "# Dune",
  metadata,
});

const OMDB_HIT = {
  Response: "True",
  Title: "The Matrix",
  Year: "1999",
  Genre: "Action, Sci-Fi",
  Director: "Lana Wachowski, Lilly Wachowski",
  Actors: "Keanu Reeves, Laurence Fishburne",
  Runtime: "136 min",
  Plot: "A hacker learns the truth.",
  Poster: "https://m.media-amazon.com/images/M/matrix.jpg",
  imdbRating: "8.7",
  imdbVotes: "2,100,000",
  imdbID: "tt0133093",
  Type: "movie",
};
const isOmdb = (u: string) => u.startsWith("https://www.omdbapi.com/");

describe("movie enrichment", () => {
  it("fills metadata and cover from OMDb by IMDb id", async () => {
    const fetch = fakeFetch([{ match: isOmdb, respond: () => json(OMDB_HIT) }]);
    const out = await enrichPayload(movie(), { fetch, omdbApiKey: "k", now: NOW });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.url).toContain("i=tt0133093");
    expect(out.metadata).toMatchObject({
      imdb_id: "tt0133093",
      year: 1999,
      genres: ["Action", "Sci-Fi"],
      director: "Lana Wachowski",
      runtime_min: 136,
      plot: "A hacker learns the truth.",
      imdb_rating: { value: 8.7, count: 2100000 },
      enrichment: { source: "omdb", confidence: 1 },
    });
    expect(out.coverImageUrl).toBe("https://m.media-amazon.com/images/M/matrix.jpg");
    expect(out.contentMd).toContain("Angereichert: OMDb");
  });

  it("keeps what the page already provided and the existing cover", async () => {
    const fetch = fakeFetch([{ match: isOmdb, respond: () => json(OMDB_HIT) }]);
    const out = await enrichPayload(
      { ...movie({ year: 2000, director: "Page Director" }), coverImageUrl: "https://x.test/c.jpg" },
      { fetch, omdbApiKey: "k", now: NOW },
    );
    expect(out.metadata).toMatchObject({ year: 2000, director: "Page Director" });
    expect(out.coverImageUrl).toBe("https://x.test/c.jpg");
  });

  it("resolves the IMDb id of a title-only film through OMDb, flagged as a guess", async () => {
    const fetch = fakeFetch([{ match: isOmdb, respond: () => json(OMDB_HIT) }]);
    const out = await enrichPayload(movie({ imdb_id: undefined }), {
      fetch,
      omdbApiKey: "k",
      now: NOW,
    });
    expect(fetch.calls[0]?.url).toContain("t=Matrix");
    expect(out.metadata).toMatchObject({
      imdb_id: "tt0133093",
      enrichment: { source: "omdb", confidence: 0.7 },
    });
  });

  it("OMDb miss: a warning, no enrichment, the ingest goes on", async () => {
    const fetch = fakeFetch([
      { match: isOmdb, respond: () => json({ Response: "False", Error: "Incorrect IMDb ID." }) },
    ]);
    const out = await enrichPayload(movie(), { fetch, omdbApiKey: "k", now: NOW });
    expect(out.metadata.enrichment).toBeUndefined();
    expect(out.metadata.warnings).toEqual([expect.stringContaining("enrich: omdb: no record")]);
    expect(out.contentMd).toBe("# Matrix");
  });

  it("blocked or failing provider: warning only, no throw", async () => {
    const blocked = fakeFetch([{ match: isOmdb, respond: () => json({ Error: "no" }, 401) }]);
    const out = await enrichPayload(movie(), { fetch: blocked, omdbApiKey: "k", now: NOW });
    expect(out.metadata.warnings).toEqual([expect.stringContaining("401")]);
    expect(JSON.stringify(out.metadata)).not.toContain("apikey");
  });

  it("timeout: aborts and warns", async () => {
    const slow = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_res, rej) =>
        init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
      )) as never;
    const out = await enrichPayload(movie(), {
      fetch: slow,
      omdbApiKey: "k",
      timeoutMs: 20,
      now: NOW,
    });
    expect(out.metadata.warnings).toEqual([expect.stringContaining("enrich:")]);
  });

  it("without a key: one routed LLM extraction, marked as a reviewable proposal", async () => {
    const fetch = fakeFetch([]);
    const model = mockModel({
      year: 1999,
      kind: "movie",
      director: "Lana Wachowski",
      genres: ["Sci-Fi"],
      plot: "Ein Hacker.",
      confidence: 0.55,
    });
    const out = await enrichPayload(movie({ imdb_id: undefined }), {
      fetch,
      model: () => model,
      now: NOW,
    });
    expect(fetch.calls).toHaveLength(0);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(out.metadata).toMatchObject({
      year: 1999,
      director: "Lana Wachowski",
      enrichment: { source: "llm", confidence: 0.55 },
    });
    // The model never invents the dedup key.
    expect(out.metadata.imdb_id).toBeUndefined();
  });

  it("without key and model: unchanged", async () => {
    const p = movie();
    expect(await enrichPayload(p, { now: NOW })).toBe(p);
  });

  it("is idempotent: skips when enrichment.source is set, unless forced", async () => {
    const fetch = fakeFetch([{ match: isOmdb, respond: () => json(OMDB_HIT) }]);
    const done = movie({ enrichment: { source: "llm", confidence: 0.4 } });
    expect(await enrichPayload(done, { fetch, omdbApiKey: "k" })).toBe(done);
    expect(fetch.calls).toHaveLength(0);
    const forced = await enrichPayload(done, { fetch, omdbApiKey: "k", force: true, now: NOW });
    expect(forced.metadata.enrichment).toMatchObject({ source: "omdb" });
  });
});

describe("book enrichment", () => {
  const ISBN = "9780441013593";
  const isOl = (u: string) => u.startsWith("https://openlibrary.org/");

  it("fills author, publisher, year, pages and cover from Open Library by ISBN", async () => {
    const fetch = fakeFetch([
      {
        match: isOl,
        respond: () =>
          json({
            [`ISBN:${ISBN}`]: {
              title: "Dune",
              authors: [{ name: "Frank Herbert" }],
              publishers: [{ name: "Ace" }],
              publish_date: "August 1, 2005",
              number_of_pages: 535,
              cover: { large: "https://covers.openlibrary.org/b/id/1-L.jpg" },
            },
          }),
      },
    ]);
    const out = await enrichPayload(book({ isbn: "978-0-441-01359-3" }), { fetch, now: NOW });
    expect(fetch.calls[0]?.url).toContain(`bibkeys=ISBN:${ISBN}`);
    expect(out.metadata).toMatchObject({
      author: "Frank Herbert",
      publisher: "Ace",
      year: 2005,
      pages: 535,
      enrichment: { source: "openlibrary", confidence: 1 },
    });
    expect(out.coverImageUrl).toBe("https://covers.openlibrary.org/b/id/1-L.jpg");
  });

  it("title only: top search hit with a confidence flag and its ISBN", async () => {
    const fetch = fakeFetch([
      {
        match: isOl,
        respond: () =>
          json({
            docs: [
              {
                author_name: ["Frank Herbert"],
                first_publish_year: 1965,
                isbn: ["not-an-isbn", ISBN],
                cover_i: 42,
              },
            ],
          }),
      },
    ]);
    const out = await enrichPayload(book(), { fetch, now: NOW });
    expect(fetch.calls[0]?.url).toContain("search.json?title=Dune");
    expect(out.metadata).toMatchObject({
      isbn: ISBN,
      author: "Frank Herbert",
      enrichment: { source: "openlibrary", confidence: 0.6 },
    });
    expect(out.coverImageUrl).toBe("https://covers.openlibrary.org/b/id/42-L.jpg");
  });

  it("unknown ISBN: warning, nothing else changes", async () => {
    const fetch = fakeFetch([{ match: isOl, respond: () => json({}) }]);
    const out = await enrichPayload(book({ isbn: ISBN }), { fetch, now: NOW });
    expect(out.metadata.enrichment).toBeUndefined();
    expect(out.metadata.warnings).toEqual([expect.stringContaining("no record for ISBN")]);
  });
});

describe("withEnrichment", () => {
  it("wraps an adapter, keeps id/canHandle and leaves other types alone", async () => {
    const note: ExtractedPayload = {
      type: "note",
      sourcePlatform: "manual",
      contentMd: "x",
      metadata: {},
    };
    const inner: IngestionAdapter = {
      id: "inner",
      canHandle: () => true,
      extract: async () => note,
    };
    const fetch = fakeFetch([]);
    const wrapped = withEnrichment(inner, { fetch, omdbApiKey: "k" });
    expect(wrapped.id).toBe("inner");
    expect(await wrapped.extract({ userId: USER_ID })).toBe(note);
    expect(fetch.calls).toHaveLength(0);
  });
});
