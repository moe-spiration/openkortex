import { describe, expect, it } from "vitest";
import { createWebArticleAdapter } from "../src/adapters/web-article.adapter";
import { parseJsonLd } from "../src/adapters/web/direct-reader";
import {
  appendKeyPoints,
  normalizeEnrichment,
  type Enrichment,
  type OrganizerContext,
} from "../src/enrichment/auto-organizer";
import { createDefaultRegistry } from "../src/adapters";
import { ingest, type IngestDeps } from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import {
  fakeFetch,
  html,
  ITEM_ID,
  mockEmbeddingModel,
  mockModel,
  staticRouter,
  USER_ID,
} from "./helpers";

const ctx: OrganizerContext = { existingTags: [], existingClusters: [], existingObjects: [] };

const raw: Enrichment = {
  title: "Titel",
  summary: "Kurz.",
  key_points: [
    "- Erster Punkt",
    "Erster Punkt",
    "2. Zweiter  Punkt",
    "",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
  ],
  cluster_name: null,
  suggested_folder_path: null,
  tags: [],
  entities: [],
  action_items: [],
};

describe("key points", () => {
  it("are cleaned, de-duplicated and capped at 7 for articles", () => {
    const r = normalizeEnrichment(
      raw,
      { type: "article", sourcePlatform: "web", contentMd: "x", isManualPlacement: false },
      ctx,
    );
    expect(r.keyPoints).toEqual(["Erster Punkt", "Zweiter Punkt", "c", "d", "e", "f", "g"]);
  });

  it("are dropped for other types and tolerate a missing field", () => {
    const base = { sourcePlatform: "x", contentMd: "x", isManualPlacement: false } as const;
    expect(normalizeEnrichment(raw, { ...base, type: "note" }, ctx).keyPoints).toEqual([]);
    expect(
      normalizeEnrichment({ ...raw, key_points: undefined }, { ...base, type: "pdf" }, ctx)
        .keyPoints,
    ).toEqual([]);
  });

  it("render as a Kernpunkte section once", () => {
    const md = appendKeyPoints("# A\n\nText", ["Eins", "Zwei"]);
    expect(md).toBe("# A\n\nText\n\n## Kernpunkte\n\n- Eins\n- Zwei\n");
    expect(appendKeyPoints(md, ["Drei"])).toBe(md);
    expect(appendKeyPoints("# A", [])).toBe("# A");
  });
});

// IMDb-like: bot wall body, but OpenGraph + JSON-LD in the head.
const imdbHtml = `<!doctype html><html lang="de"><head>
<title>Film (2025) - IMDb</title>
<meta property="og:title" content="Der Film (2025)">
<meta property="og:description" content="Ein Thriller über eine Heist-Crew.">
<meta property="og:image" content="https://m.media-amazon.com/poster.jpg">
<meta property="og:site_name" content="IMDb">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Movie","name":"Der Film","description":"Ein Thriller.","image":"https://m.media-amazon.com/poster.jpg","genre":["Action","Thriller"],"director":[{"@type":"Person","name":"Jane Doe"}],"datePublished":"2025-05-01","aggregateRating":{"ratingValue":7.4,"bestRating":10}}</script>
</head><body><div id="root"></div></body></html>`;

describe("metadata-only web fallback", () => {
  it("parses schema.org JSON-LD (walks @graph, skips WebSite)", () => {
    const sd = parseJsonLd([
      "not json",
      JSON.stringify({
        "@graph": [
          { "@type": "WebSite", name: "Site" },
          { "@type": "Product", name: "Lift", brand: { name: "ACME" } },
        ],
      }),
    ]);
    expect(sd).toMatchObject({
      type: "Product",
      name: "Lift",
      facts: [{ label: "Marke", value: "ACME" }],
    });
  });

  it("turns an IMDb page without readable body into a usable item", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => html(imdbHtml) }]);
    const out = await createWebArticleAdapter({ fetch }).extract({
      userId: USER_ID,
      url: "https://www.imdb.com/de/title/tt32375763/",
    });
    expect(out.titleHint).toBe("Der Film (2025)");
    expect(out.coverImageUrl).toBe("https://m.media-amazon.com/poster.jpg");
    expect(out.contentMd).toContain("Ein Thriller über eine Heist-Crew.");
    expect(out.contentMd).toContain("- **Genre:** Action, Thriller");
    expect(out.contentMd).toContain("- **Regie:** Jane Doe");
    expect(out.contentMd).toContain("- **Bewertung:** 7.4/10");
    expect(out.metadata).toMatchObject({
      extractor: "metadata",
      direct_method: "metadata",
      published_time: "2025-05-01",
    });
  });

  it("still fails for a page with no title and description", async () => {
    const fetch = fakeFetch([
      { match: () => true, respond: () => html("<html><body>x</body></html>") },
    ]);
    await expect(
      createWebArticleAdapter({ fetch }).extract({ userId: USER_ID, url: "https://example.com/" }),
    ).rejects.toThrow(/could not extract/);
  });

  it("ingest stores it as processed", async () => {
    const storage = createMemoryStorageGateway();
    const models = staticRouter({
      fast: mockModel({ ...raw, key_points: [] }),
      embedding: mockEmbeddingModel(),
    });
    const fetch = fakeFetch([{ match: () => true, respond: () => html(imdbHtml) }]);
    const deps: IngestDeps = {
      registry: createDefaultRegistry({ storage, models, fetch }),
      models,
      generateId: () => ITEM_ID,
    };
    const res = await ingest(
      { userId: USER_ID, url: "https://www.imdb.com/de/title/tt32375763/" },
      ctx,
      deps,
    );
    expect(res.item.status).toBe("processed");
    expect(res.item.cover_image_url).toBe("https://m.media-amazon.com/poster.jpg");
  });

  it("ingest adds key points to content and metadata for articles", async () => {
    const storage = createMemoryStorageGateway();
    const models = staticRouter({
      fast: mockModel({ ...raw, key_points: ["Punkt A", "Punkt B", "Punkt C"] }),
      embedding: mockEmbeddingModel(),
    });
    const fetch = fakeFetch([{ match: () => true, respond: () => html(imdbHtml) }]);
    const deps: IngestDeps = {
      registry: createDefaultRegistry({ storage, models, fetch }),
      models,
      generateId: () => ITEM_ID,
    };
    const res = await ingest(
      // IMDb titles go to the movie adapter now; the same page on another host stays an article.
      { userId: USER_ID, url: "https://filmblog.example.com/der-film-2025" },
      ctx,
      deps,
    );
    expect(res.item.content_md).toContain("## Kernpunkte\n\n- Punkt A\n- Punkt B\n- Punkt C");
    expect(res.item.metadata).toMatchObject({ key_points: ["Punkt A", "Punkt B", "Punkt C"] });
  });
});
