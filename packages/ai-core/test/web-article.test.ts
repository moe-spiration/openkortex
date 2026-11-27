import { describe, expect, it } from "vitest";
import {
  createWebArticleAdapter,
  FIRECRAWL_SCRAPE_URL,
  JINA_READER_URL,
} from "../src/adapters/web-article.adapter";
import { ExtractionError } from "../src/errors";
import { fakeFetch, html, json, USER_ID } from "./helpers";
import { createPdfDocumentAdapter } from "../src/adapters/pdf-document.adapter";
import { createMemoryStorageGateway } from "../src/storage";
import { makePdf } from "./fixtures/make-pdf";
import { firecrawlResponse, jinaResponse } from "./fixtures/web-article";

const URL_ = "https://www.heise.de/hintergrund/mcp-erklaert-1234.html";
const input = { userId: USER_ID, url: URL_ };

describe("web-article adapter", () => {
  it("uses page content the caller already has, without any fetch (import)", async () => {
    const fetch = fakeFetch([]);
    const adapter = createWebArticleAdapter({ fetch, jinaApiKey: "jina_test" });
    const markdown = `# Aus Recall\n\n${"Der gespeicherte Artikeltext. ".repeat(20)}`;
    const out = await adapter.extract({ ...input, pageContent: { markdown, title: "Aus Recall" } });
    expect(fetch.calls).toHaveLength(0);
    expect(out.contentMd).toContain("Der gespeicherte Artikeltext.");
    expect(out.titleHint).toBe("Aus Recall");
    expect(out.metadata).toMatchObject({ extractor: "import" });
  });

  it("extracts clean Markdown via Jina Reader", async () => {
    const fetch = fakeFetch([
      { match: (u) => u.startsWith(JINA_READER_URL), respond: () => json(jinaResponse) },
    ]);
    const adapter = createWebArticleAdapter({ fetch, jinaApiKey: "jina_test" });
    expect(adapter.canHandle(input)).toBe(true);

    const out = await adapter.extract(input);
    expect(fetch.calls[0]?.url).toBe(`${JINA_READER_URL}${URL_}`);
    expect(fetch.calls[0]?.headers.authorization).toBe("Bearer jina_test");
    expect(fetch.calls[0]?.headers["x-return-format"]).toBe("markdown");
    expect(out.type).toBe("article");
    expect(out.sourcePlatform).toBe("web");
    expect(out.titleHint).toBe("Model Context Protocol erklärt");
    expect(out.contentMd).toMatch(/^# Model Context Protocol erklärt/);
    expect(out.contentMd).not.toMatch(/\n{3,}/);
    expect(out.coverImageUrl).toBe("https://heise.cloudimg.io/mcp.jpg");
    expect(out.metadata).toMatchObject({
      extractor: "jina",
      site: "heise online",
      domain: "heise.de",
    });
  });

  it("falls back to Firecrawl when Jina fails", async () => {
    const fetch = fakeFetch([
      { match: (u) => u.startsWith(JINA_READER_URL), respond: () => json({ code: 451 }, 451) },
      { match: (u) => u === FIRECRAWL_SCRAPE_URL, respond: () => json(firecrawlResponse) },
    ]);
    const out = await createWebArticleAdapter({
      fetch,
      jinaApiKey: "jina_test",
      firecrawlApiKey: "fc-test",
    }).extract(input);
    const fc = fetch.calls[1];
    expect(fc?.method).toBe("POST");
    expect(fc?.headers.authorization).toBe("Bearer fc-test");
    expect(fc?.body).toEqual({ url: URL_, formats: ["markdown"], onlyMainContent: true });
    expect(out.metadata.extractor).toBe("firecrawl");
    expect(out.titleHint).toBe("MCP erklärt (Firecrawl)");
    expect(out.coverImageUrl).toBe("https://heise.cloudimg.io/og.jpg");
    expect(out.metadata.extraction_fallback_reasons).toEqual([expect.stringContaining("451")]);
  });

  it("falls back to Firecrawl when Jina returns almost nothing (consent wall)", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u.startsWith(JINA_READER_URL),
        respond: () => json({ data: { title: "Cookies", content: "Bitte zustimmen" } }),
      },
      { match: (u) => u === FIRECRAWL_SCRAPE_URL, respond: () => json(firecrawlResponse) },
    ]);
    const out = await createWebArticleAdapter({
      fetch,
      jinaApiKey: "jina_test",
      firecrawlApiKey: "fc-test",
    }).extract(input);
    expect(out.metadata.extractor).toBe("firecrawl");
  });

  it("throws ExtractionError when every extractor fails", async () => {
    const fetch = fakeFetch([
      { match: (u) => u.startsWith(JINA_READER_URL), respond: () => json({}, 500) },
      {
        match: (u) => u === FIRECRAWL_SCRAPE_URL,
        respond: () => json({ success: false, error: "blocked" }),
      },
    ]);
    const err = await createWebArticleAdapter({ fetch, jinaApiKey: "j", firecrawlApiKey: "k" })
      .extract(input)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    // Jina, Firecrawl and the direct fetch were all tried, and every reason is reported.
    expect(fetch.calls.map((c) => c.url)).toEqual([
      `${JINA_READER_URL}${URL_}`,
      FIRECRAWL_SCRAPE_URL,
      URL_,
    ]);
    expect((err as Error).message).toMatch(
      /500.*firecrawl: blocked.*request to www.heise.de failed/s,
    );
    // Without keys: the direct fetch, then one keyless reader try.
    const fetch2 = fakeFetch([{ match: () => true, respond: () => json({}, 500) }]);
    await expect(createWebArticleAdapter({ fetch: fetch2 }).extract(input)).rejects.toThrow(
      /could not extract/,
    );
    expect(fetch2.calls.map((c) => c.url)).toEqual([URL_, `${JINA_READER_URL}${URL_}`]);
    expect(fetch2.calls[1]!.headers.authorization).toBeUndefined();
    // Switched off (KORTEX_KEYLESS_READER=off): only the direct fetch.
    const fetch3 = fakeFetch([{ match: () => true, respond: () => json({}, 500) }]);
    await expect(
      createWebArticleAdapter({ fetch: fetch3, keylessReader: false }).extract(input),
    ).rejects.toThrow(/could not extract/);
    expect(fetch3.calls).toHaveLength(1);
  });

  it("only handles http(s) URLs without a file", () => {
    const a = createWebArticleAdapter();
    expect(a.canHandle({ userId: USER_ID, url: "ftp://x.org/file" })).toBe(false);
    expect(a.canHandle({ userId: USER_ID, rawText: "hi" })).toBe(false);
    expect(a.canHandle({ userId: USER_ID, url: URL_, fileBuffer: new Uint8Array(1) })).toBe(false);
  });
});

describe("web-article fallbacks for shared links", () => {
  it("reads a page that blocks the direct fetch through the keyless reader", async () => {
    const fetch = fakeFetch([
      { match: (u) => u === URL_, respond: () => html("<html><head><title>Access Denied</title></head></html>", 403) },
      { match: (u) => u.startsWith(JINA_READER_URL), respond: () => json(jinaResponse) },
    ]);
    const out = await createWebArticleAdapter({ fetch }).extract(input);
    expect(out.metadata.extractor).toBe("jina");
    expect(out.titleHint).toBe("Model Context Protocol erklärt");
    expect(fetch.calls[1]!.headers.authorization).toBeUndefined();
  });

  it("reads a linked PDF as a document instead of an empty bookmark", async () => {
    const pdfUrl = "https://www.example.com/asset/expose-uhland-quartier.pdf";
    const bytes = makePdf({ title: "Expose Uhland-Quartier", pages: ["Lage und Flaechen des Quartiers."] });
    const pdfResponse = () =>
      new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } });
    const fetch = fakeFetch([{ match: (u) => u === pdfUrl, respond: pdfResponse }]);
    const storage = createMemoryStorageGateway();
    const out = await createWebArticleAdapter({
      fetch,
      documentAdapter: createPdfDocumentAdapter({ storage }),
    }).extract({ userId: USER_ID, itemId: "11111111-2222-4333-8444-555555555555", url: pdfUrl });
    expect(out.type).toBe("pdf");
    expect(out.contentMd).toContain("Lage und Flaechen des Quartiers.");
    expect(out.sourceUrl).toBe(pdfUrl);
    expect(out.metadata).toMatchObject({ extractor: "pdf-link", source_url: pdfUrl });
    // No reader detour for a document.
    expect(fetch.calls.every((c) => c.url === pdfUrl)).toBe(true);
  });
});
