import { describe, expect, it } from "vitest";
import { readHtml } from "../src/adapters/web/direct-reader";
import { linkTextRatio } from "../src/adapters/web/listing";
import { tidyClipMarkdown } from "../src/adapters/web/tidy";
import {
  createWebArticleAdapter,
  FIRECRAWL_SCRAPE_URL,
} from "../src/adapters/web-article.adapter";
import { articleHtml } from "./fixtures/direct-html";
import { aggregatorHtml, newsListingHtml } from "./fixtures/listing-html";
import { createDefaultRegistry } from "../src/adapters";
import { ingest, type IngestDeps } from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import {
  fakeFetch,
  ITEM_ID,
  json,
  mockEmbeddingModel,
  mockModel,
  staticRouter,
  USER_ID,
} from "./helpers";

const NEWS = "https://news.example.com/technik/";

const htmlResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("listing pages", () => {
  it("turns a news front page into one clean bullet per card", async () => {
    const r = await readHtml(newsListingHtml, NEWS);
    expect(r.method).toBe("listing");
    expect(r.listingItems).toBe(7);
    expect(r.markdown).toMatch(/^# Technik-News\n\nAktuelle Nachrichten aus der IT\.\n\n- \[/);
    // Kicker and headline separated, teaser on its own indented line.
    expect(r.markdown).toContain(
      "- [Chipindustrie: Neue Fabrik für europäische Halbleiter](https://news.example.com/news/artikel-1.html)\n" +
        "  Die EU fördert ein Werk in Dresden mit mehreren Milliarden Euro.",
    );
    // No ad card, no chrome, no thumbnails, no inline references, no counters.
    for (const noise of [
      "Laptop sichern",
      "Anzeige",
      "Zur Startseite",
      "Cookies",
      "Impressum",
      "Dossier",
      "Ältere Artikel",
      "![",
    ]) {
      expect(r.markdown).not.toContain(noise);
    }
    expect(r.markdown).not.toMatch(/\n\s*\d+\s*$/m);
  });

  it("reads a link aggregator table as titles only, without votes, users, times and comments", async () => {
    const r = await readHtml(aggregatorHtml, "https://links.example.com/");
    expect(r.method).toBe("listing");
    expect(r.markdown.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(7);
    expect(r.markdown).toContain(
      "- [A new database written in Rust is fast](https://db.example.org/post-1)",
    );
    expect(r.markdown).not.toMatch(/\| |hours ago|comments|points by|\]\(\)/);
  });

  it("keeps an article with a related-articles box as an article", async () => {
    const related = Array.from(
      { length: 8 },
      (_, i) =>
        `<li><a href="/posts/verwandt-${i}"><h3>Verwandter Beitrag Nummer ${i} zum Thema</h3></a><p>Kurzer Anreißer für den verwandten Beitrag ${i} im Blog.</p></li>`,
    ).join("");
    const html = articleHtml.replace("</main>", `<section class="related"><ul>${related}</ul></section></main>`);
    const r = await readHtml(html, "https://blog.example.com/posts/mcp-erklaert");
    expect(r.method).toBe("readability");
    expect(r.markdown).toContain("Absatz 6: Das Model Context Protocol verbindet Agenten");
  });

  it("prefers the direct card list over Firecrawl link soup", async () => {
    const soup = [
      "[Zur Startseite](https://news.example.com/)",
      ...Array.from(
        { length: 8 },
        (_, i) =>
          `[![](<Base64-Image-Removed>)\\\\\nTeaser ${i} mit etwas Text](https://news.example.com/news/artikel-${i}.html)\n\n* * *\n\nAnzeige`,
      ),
    ].join("\n\n");
    expect(linkTextRatio(soup)).toBeGreaterThan(0.5);
    const fetch = fakeFetch([
      {
        match: (u) => u === FIRECRAWL_SCRAPE_URL,
        respond: () => json({ success: true, data: { markdown: soup, metadata: { title: "Technik-News" } } }),
      },
      { match: (u) => u === NEWS, respond: () => htmlResponse(newsListingHtml) },
    ]);
    const out = await createWebArticleAdapter({ fetch, firecrawlApiKey: "fc_x" }).extract({
      userId: USER_ID,
      url: NEWS,
    });
    expect(out.metadata).toMatchObject({
      extractor: "direct",
      direct_method: "listing",
      page_kind: "listing",
      listing_items: 7,
    });
    expect(out.contentMd).toContain("- [Raumfahrt: Voyager 1 meldet sich wieder]");
    expect(out.contentMd).not.toContain("Base64");
  });
});

describe("ingest of a listing page", () => {
  it("stores the card list without Kernpunkte or Erwähnt sections", async () => {
    const models = staticRouter({
      fast: mockModel({
        title: "Technik-News",
        summary: "Schlagzeilen aus der IT.",
        key_points: ["Neue Fabrik", "Voyager meldet sich"],
        cluster_name: null,
        suggested_folder_path: null,
        tags: [],
        entities: [],
        action_items: [],
        mentions: [{ name: "Linux", kind: "tool" }],
      }),
      embedding: mockEmbeddingModel(),
    });
    const fetch = fakeFetch([{ match: () => true, respond: () => htmlResponse(newsListingHtml) }]);
    const deps: IngestDeps = {
      registry: createDefaultRegistry({ storage: createMemoryStorageGateway(), models, fetch }),
      models,
      generateId: () => ITEM_ID,
    };
    const res = await ingest(
      { userId: USER_ID, url: NEWS },
      { existingTags: [], existingClusters: [], existingObjects: [] },
      deps,
    );
    expect(res.item.content_md).toContain("- [Raumfahrt: Voyager 1 meldet sich wieder]");
    expect(res.item.content_md).not.toMatch(/## (Kernpunkte|Erwähnt)/);
    expect(res.item.summary).toBe("Schlagzeilen aus der IT.");
  });
});

describe("tidyClipMarkdown", () => {
  it("drops placeholders, empty links, ad labels, separator runs and repeated paragraphs", () => {
    const md = [
      "# Titel",
      "[![](<Base64-Image-Removed>)\\\\\nEin Teaser](https://a.example/x)",
      "[](https://a.example/vote)",
      "Anzeige",
      "* * *\n\n* * *",
      "Ein Absatz, der doppelt gerendert wurde, weil die Seite responsiv ist.",
      "Ein Absatz, der doppelt gerendert wurde, weil die Seite responsiv ist.",
      "![Icon](https://a.example/icon.svg) Rest",
      "- [ ] Aufgabe bleibt",
      "```\nx\n```",
    ].join("\n\n");
    expect(tidyClipMarkdown(md)).toBe(
      [
        "# Titel",
        "[Ein Teaser](https://a.example/x)",
        "---",
        "Ein Absatz, der doppelt gerendert wurde, weil die Seite responsiv ist.",
        "Rest",
        "- [ ] Aufgabe bleibt",
        "```\nx\n```",
      ].join("\n\n"),
    );
  });
});
