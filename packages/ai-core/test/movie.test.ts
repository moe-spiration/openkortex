import { describe, expect, it } from "vitest";
import { ADAPTER_PRIORITY, createDefaultRegistry } from "../src/adapters";
import {
  createMovieAdapter,
  imdbTitleId,
  movieFromClientHint,
} from "../src/adapters/movie.adapter";
import { AdapterDeclinedError } from "../src/errors";
import { createMemoryStorageGateway } from "../src/storage";
import { fakeFetch, html, staticRouter, USER_ID } from "./helpers";
import { imdbMovieHtml, imdbSeriesHtml } from "./fixtures/movie";

// Feedback G2: films and series from imdb.com.
const MOVIE = "https://www.imdb.com/de/title/tt0000001/";
const SERIES = "https://www.imdb.com/title/tt0000002/?ref_=nv_sr_1";

describe("imdbTitleId", () => {
  it.each([
    ["https://www.imdb.com/title/tt0111161/", "tt0111161"],
    ["https://www.imdb.com/de/title/tt34890576/?ref_=x", "tt34890576"],
    ["https://m.imdb.com/title/tt0903747/", "tt0903747"],
    ["https://www.imdb.com/name/nm0000209/", undefined],
    ["https://example.com/title/tt0111161/", undefined],
  ])("%s → %s", (url, id) => expect(imdbTitleId(url)).toBe(id));
});

describe("movie adapter", () => {
  it("fetches with a link-preview user agent and builds a film note", async () => {
    let ua: string | null = null;
    const fetch = fakeFetch([
      {
        match: (u) => u === MOVIE,
        respond: (_u, init) => {
          ua = new Headers(init?.headers).get("User-Agent");
          return html(imdbMovieHtml);
        },
      },
    ]);
    const adapter = createMovieAdapter({ fetch });
    expect(adapter.canHandle({ userId: USER_ID, url: MOVIE })).toBe(true);
    const out = await adapter.extract({ userId: USER_ID, url: MOVIE });

    expect(ua).toMatch(/facebookexternalhit/);
    expect(out.type).toBe("movie");
    expect(out.sourcePlatform).toBe("imdb");
    expect(out.titleHint).toBe("Lehmgesicht (2026)");
    expect(out.coverImageUrl).toBe("https://m.media-amazon.com/images/M/poster1.jpg");
    expect(out.metadata).toMatchObject({
      media_kind: "movie",
      imdb_id: "tt0000001",
      extractor: "json-ld",
      original_title: "Clayface",
      year: 2026,
      runtime_min: 108,
      genres: ["Horror", "Science-Fiction", "Thriller"],
      imdb_rating: { value: 7.5, count: 31884 },
      content_rating: "16",
      directors: ["Jan Regie"],
      writers: ["Eva Autorin", "Tom Feder"],
      countries: ["Vereinigtes Königreich"],
      kind: "movie",
      status: "to_watch",
      director: "Jan Regie",
      cast: ["Ada Beispiel", "Ben Neben", "Cem Ohne"],
      cast_roles: [
        { name: "Ada Beispiel", character: "Matt Hagen" },
        { name: "Ben Neben", character: "Fahrer" },
        { name: "Cem Ohne" },
      ],
      trailer_url: "https://www.imdb.com/de/video/vi1/",
    });
    expect(out.contentMd).toBe(
      [
        "# Lehmgesicht (2026)",
        "",
        "> Ein Filmstar verwandelt sich in ein Monster aus Lehm.",
        "",
        "**Typ:** Film · **Jahr:** 2026 · **Laufzeit:** 1 Std. 48 Min. · **Freigabe:** 16 · **IMDb:** 7,5/10 (31.884 Stimmen)",
        "",
        "**Genre:** Horror, Science-Fiction, Thriller",
        "",
        "## Stab",
        "",
        "- **Originaltitel:** Clayface",
        "- **Regie:** Jan Regie",
        "- **Drehbuch:** Eva Autorin, Tom Feder",
        "- **Land:** Vereinigtes Königreich",
        "",
        "## Besetzung",
        "",
        "| Darsteller:in | Rolle |",
        "| --- | --- |",
        "| Ada Beispiel | Matt Hagen |",
        "| Ben Neben | Fahrer |",
        "| Cem Ohne |  |",
        "",
        `[Trailer](https://www.imdb.com/de/video/vi1/) · Quelle: [IMDb](${MOVIE})`,
      ].join("\n"),
    );
    // Reviews and page chrome stay out.
    expect(out.contentMd).not.toMatch(/Nutzerkritik|Werbung/);
  });

  it("formats series with year range, episode length and creator", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => html(imdbSeriesHtml) }]);
    const out = await createMovieAdapter({ fetch }).extract({ userId: USER_ID, url: SERIES });
    expect(out.titleHint).toBe("Chemie-Lehrer (2008–2013)");
    expect(out.coverImageUrl).toBe("https://m.media-amazon.com/images/M/poster2.jpg");
    expect(out.metadata).toMatchObject({ media_kind: "series", year: 2008, end_year: 2013 });
    expect(out.contentMd).toContain(
      "**Typ:** Serie · **Jahr:** 2008–2013 · **Folgenlänge:** 48 Min. · **IMDb:** 9,5/10 (2.699.258 Stimmen)",
    );
    expect(out.contentMd).toContain("- **Idee:** Vince Idee");
    // No original title line when it equals the title; JSON-LD actors without roles are a list.
    expect(out.contentMd).not.toContain("Originaltitel");
    expect(out.contentMd).toContain("## Besetzung\n\n- Walt Darsteller");
  });

  it("falls back to what the client saw when IMDb blocks the server (202, empty body)", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => new Response("", { status: 202 }) }]);
    const out = await createMovieAdapter({ fetch }).extract({
      userId: USER_ID,
      url: MOVIE,
      clientHint: {
        title: "Lehmgesicht (2026) ⭐ 7.6 | Horror, Science-Fiction, Thriller",
        description: "1h 48m | 16",
        imageUrl: "https://m.media-amazon.com/images/M/og.jpg",
      },
    });
    expect(out.metadata).toMatchObject({
      extractor: "client",
      year: 2026,
      runtime_min: 108,
      imdb_rating: { value: 7.6, count: null },
      content_rating: "16",
      genres: ["Horror", "Science-Fiction", "Thriller"],
    });
    expect(out.metadata.warnings).toEqual([expect.stringContaining("imdb:")]);
    expect(out.coverImageUrl).toBe("https://m.media-amazon.com/images/M/og.jpg");
    expect(out.contentMd).toBe(
      [
        "# Lehmgesicht (2026)",
        "",
        "**Typ:** Film · **Jahr:** 2026 · **Laufzeit:** 1 Std. 48 Min. · **Freigabe:** 16 · **IMDb:** 7,6/10",
        "",
        "**Genre:** Horror, Science-Fiction, Thriller",
        "",
        `Quelle: [IMDb](${MOVIE})`,
      ].join("\n"),
    );
  });

  it("reads other IMDb title formats from the client", () => {
    expect(movieFromClientHint({ title: "Chemie-Lehrer (TV Series 2008–2013) - IMDb" })).toMatchObject(
      { kind: "series", title: "Chemie-Lehrer", year: 2008, endYear: 2013 },
    );
    expect(
      movieFromClientHint({ title: "Lehmgesicht (2026): Horror, Thriller auf IMDb" }),
    ).toMatchObject({ kind: "movie", year: 2026, genres: ["Horror", "Thriller"] });
    expect(movieFromClientHint({ title: "IMDb: Ratings, Reviews" })).toBeUndefined();
  });

  it("declines when neither the page nor the client has film data", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => new Response("", { status: 202 }) }]);
    await expect(
      createMovieAdapter({ fetch }).extract({ userId: USER_ID, url: MOVIE }),
    ).rejects.toBeInstanceOf(AdapterDeclinedError);
  });

  it("is registered before the recipe and article adapters", () => {
    expect(ADAPTER_PRIORITY.movie).toBeGreaterThan(ADAPTER_PRIORITY.recipe);
    const registry = createDefaultRegistry({
      storage: createMemoryStorageGateway(),
      models: staticRouter({}),
    });
    expect(registry.resolve({ userId: USER_ID, url: MOVIE })?.id).toBe("movie");
    expect(registry.resolve({ userId: USER_ID, url: "https://www.imdb.com/name/nm1/" })?.id).toBe(
      "web-article",
    );
  });
});
