import { describe, expect, it } from "vitest";
import { decodeHtml, readDirect } from "../src/adapters/web/direct-reader";
import {
  createWebArticleAdapter,
  FIRECRAWL_SCRAPE_URL,
  JINA_READER_URL,
} from "../src/adapters/web-article.adapter";
import { ExtractionError } from "../src/errors";
import { articleHtml, latin1Bytes, latin1Html, shortHtml } from "./fixtures/direct-html";
import { fakeFetch, json, USER_ID } from "./helpers";

const URL_ = "https://blog.example.com/posts/mcp-erklaert?utm_source=x";

const htmlResponse = (body: string | Uint8Array, type = "text/html; charset=utf-8") =>
  new Response(body, { status: 200, headers: { "content-type": type } });

describe("readDirect", () => {
  it("extracts the main content as Markdown with OpenGraph metadata and absolute links", async () => {
    const fetch = fakeFetch([
      { match: (u) => u === URL_, respond: () => htmlResponse(articleHtml) },
    ]);
    const r = await readDirect(fetch, URL_);

    expect(fetch.calls[0]?.headers["user-agent"]).toMatch(/Mozilla\/5\.0/);
    expect(fetch.calls[0]?.headers.accept).toContain("text/html");
    expect(r).toMatchObject({
      method: "readability",
      title: "Model Context Protocol erklärt",
      description: "Was MCP ist und warum es für Second Brains zählt.",
      coverImageUrl: "https://blog.example.com/img/mcp-hero.jpg",
      canonicalUrl: "https://blog.example.com/mcp-erklaert",
      siteName: "Tech-Blog",
      publishedTime: "2026-10-20T08:00:00+02:00",
      language: "de",
      truncated: false,
    });
    const md = r.markdown;
    expect(md).toMatch(/^# Model Context Protocol erklärt\n/);
    expect(md).toContain("Absatz 6: Das Model Context Protocol verbindet Agenten");
    expect(md).toContain("[Spezifikations-Überblick](https://blog.example.com/docs/spec)");
    // Lazy image promoted to its real source; data: placeholder gone.
    expect(md).toContain("![Architekturdiagramm](https://blog.example.com/img/diagram.png)");
    expect(md).not.toContain("data:image");
    expect(md).toContain("```\nnpx @modelcontextprotocol/inspector\n```");
    // Chrome and scripts are not content.
    for (const noise of [
      "Newsletter abonnieren",
      "Impressum",
      "window.tracking",
      "Archiv",
      "font-family",
    ]) {
      expect(md).not.toContain(noise);
    }
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("falls back to the cleaned main region when Readability finds nothing", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => htmlResponse(shortHtml) }]);
    const r = await readDirect(fetch, "https://status.example.com/");
    expect(r.title).toBe("Kurzinfo");
    expect(r.markdown).toContain("Ein kurzer Hinweis zur Wartung");
    expect(r.markdown).not.toContain("Menü");
    expect(r.markdown).not.toContain("Footer");
  });

  it("decodes the charset from <meta charset> when the header has none", async () => {
    const fetch = fakeFetch([
      { match: () => true, respond: () => htmlResponse(latin1Bytes(latin1Html), "text/html") },
    ]);
    const r = await readDirect(fetch, "https://news.example.ch/artikel");
    expect(r.title).toBe("Größenänderung");
    expect(r.markdown).toContain(
      "Übergrößen und Maße für Bücher, Österreich und Zürich. Straßen über Brücken.",
    );
    expect(decodeHtml(new TextEncoder().encode("ä"), "text/html; charset=utf-8")).toBe("ä");
    expect(decodeHtml(new TextEncoder().encode("ä"), "text/html; charset=bogus-charset")).toBe("ä");
  });

  it("caps the download size", async () => {
    const huge = articleHtml.replace("</main>", `<p>${"x".repeat(20_000)}</p></main>`);
    const fetch = fakeFetch([{ match: () => true, respond: () => htmlResponse(huge) }]);
    const r = await readDirect(fetch, URL_, { maxBytes: 4_000 });
    expect(r.truncated).toBe(true);
    expect(r.title).toBe("Model Context Protocol erklärt");
  });

  it("refuses non-HTML responses", async () => {
    const fetch = fakeFetch([
      {
        match: () => true,
        respond: () => new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } }),
      },
    ]);
    await expect(readDirect(fetch, "https://x.example.com/file")).rejects.toThrow(
      /not an HTML page \(application\/pdf\)/,
    );
  });
});

describe("web-article fallback chain", () => {
  const input = { userId: USER_ID, url: URL_ };

  it("without keys: skips Jina and Firecrawl and clips the page directly", async () => {
    const fetch = fakeFetch([
      { match: (u) => u === URL_, respond: () => htmlResponse(articleHtml) },
    ]);
    const out = await createWebArticleAdapter({ fetch }).extract(input);
    expect(fetch.calls.map((c) => c.url)).toEqual([URL_]);
    expect(out).toMatchObject({
      type: "article",
      titleHint: "Model Context Protocol erklärt",
      coverImageUrl: "https://blog.example.com/img/mcp-hero.jpg",
      sourceUrl: "https://blog.example.com/mcp-erklaert",
    });
    expect(out.metadata).toMatchObject({
      extractor: "direct",
      direct_method: "readability",
      site: "Tech-Blog",
      language: "de",
    });
    expect(out.metadata.extraction_fallback_reasons).toBeUndefined();
  });

  it("with keys: Jina → Firecrawl → direct, and records why each step failed", async () => {
    const fetch = fakeFetch([
      { match: (u) => u.startsWith(JINA_READER_URL), respond: () => json({ code: 401 }, 401) },
      {
        match: (u) => u === FIRECRAWL_SCRAPE_URL,
        respond: () => json({ success: false, error: "Payment required" }),
      },
      { match: (u) => u === URL_, respond: () => htmlResponse(articleHtml) },
    ]);
    const out = await createWebArticleAdapter({
      fetch,
      jinaApiKey: "jina_x",
      firecrawlApiKey: "fc_x",
    }).extract(input);
    expect(fetch.calls.map((c) => c.url)).toEqual([
      `${JINA_READER_URL}${URL_}`,
      FIRECRAWL_SCRAPE_URL,
      URL_,
    ]);
    expect(out.metadata.extractor).toBe("direct");
    expect(out.metadata.extraction_fallback_reasons).toEqual([
      expect.stringContaining("401"),
      expect.stringContaining("Payment required"),
    ]);
  });

  it("fails with all reasons when even the direct page is unusable", async () => {
    const fetch = fakeFetch([
      { match: () => true, respond: () => htmlResponse("<html><body><p>Kurz.</p></body></html>") },
    ]);
    const err = await createWebArticleAdapter({ fetch })
      .extract(input)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as Error).message).toContain("direct: content too short");
  });
});
