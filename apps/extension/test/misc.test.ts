// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractPageMeta } from "../src/lib/page-meta";
import { detectKind, normalizeUserTag, suggestTags } from "../src/lib/suggest";
import { DEFAULT_SETTINGS, isMockMode, loadSettings, memoryStore, normalizeBaseUrl, saveSettings } from "../src/lib/settings";

describe("extractPageMeta", () => {
  it("reads OpenGraph data, resolves relative images and prefers a same-host canonical", () => {
    document.head.innerHTML = `
      <title>Fallback title</title>
      <meta property="og:title" content="Contextual Retrieval in der Praxis">
      <meta property="og:description" content="Die meisten RAG-Systeme scheitern an Chunks.">
      <meta property="og:image" content="/img/cover.webp">
      <meta property="og:site_name" content="Engineering Notes">
      <meta name="keywords" content="rag, retrieval , ">
      <meta property="article:tag" content="llm">
      <link rel="canonical" href="https://www.engineering-notes.dev/contextual-retrieval">`;
    document.body.innerHTML = `<p>${"wort ".repeat(900)}</p>`;
    const m = extractPageMeta(document, "https://www.engineering-notes.dev/contextual-retrieval?utm_source=x");
    expect(m).toMatchObject({
      url: "https://www.engineering-notes.dev/contextual-retrieval",
      title: "Contextual Retrieval in der Praxis",
      description: "Die meisten RAG-Systeme scheitern an Chunks.",
      image_url: "https://www.engineering-notes.dev/img/cover.webp",
      site_name: "Engineering Notes",
      domain: "engineering-notes.dev",
      keywords: ["rag", "retrieval", "llm"],
    });
    expect(m.reading_minutes).toBe(4);
  });

  it("falls back to the document title and ignores a foreign canonical", () => {
    document.head.innerHTML = `<title> Plain page </title><link rel="canonical" href="https://evil.example/x">`;
    document.body.innerHTML = "<p>short</p>";
    const m = extractPageMeta(document, "https://a.dev/p");
    expect(m).toMatchObject({ url: "https://a.dev/p", title: "Plain page", description: null, image_url: null, reading_minutes: null });
  });
});

describe("suggestions", () => {
  it("proposes hashtags from the page text", () => {
    expect(suggestTags({ title: "Contextual Retrieval in der Praxis: Chunks im RAG", description: "MCP und Agenten" })).toEqual([
      "ai/mcp",
      "ai/rag",
      "ai/agents",
    ]);
    expect(suggestTags({ title: "Leadership im SDV Zeitalter" })).toEqual(["strategy/mba", "automotive/it"]);
    expect(suggestTags({ title: "Kuchenrezepte" })).toEqual([]);
    expect(suggestTags({ title: "MCP RAG agent", }, 1)).toEqual(["ai/mcp"]);
  });
  it("detects the content kind of a URL", () => {
    expect(detectKind("https://www.youtube.com/watch?v=1").type).toBe("video");
    expect(detectKind("https://example.com/a.pdf").type).toBe("pdf");
    expect(detectKind("https://x.com/a/status/1").type).toBe("social");
    expect(detectKind("https://engineering-notes.dev/x")).toEqual({ type: "article", space: "Artikel und Web" });
  });
  it("normalises user tags", () => {
    expect(normalizeUserTag(" #AI/MCP ")).toBe("ai/mcp");
    expect(normalizeUserTag("two words")).toBe("two-words");
    expect(normalizeUserTag("bad!tag")).toBeNull();
    expect(normalizeUserTag("#")).toBeNull();
  });
});

describe("settings", () => {
  it("carries no server address and is in automatic mock mode until a token is set", async () => {
    const fresh = await loadSettings(memoryStore());
    expect(fresh.baseUrl).toBe("");
    expect(fresh.mockMode).toBeNull();
    expect(DEFAULT_SETTINGS.token).toBe("");
    expect(isMockMode(fresh)).toBe(true);
    expect(isMockMode({ ...fresh, token: "  " })).toBe(true);
    expect(isMockMode({ ...fresh, token: "kx_abc" })).toBe(false);
  });
  it("lets an explicit choice win over the token", () => {
    expect(isMockMode({ mockMode: true, token: "kx_abc" })).toBe(true);
    expect(isMockMode({ mockMode: false, token: "" })).toBe(false);
  });
  it("keeps an empty address empty: a build without its own Kortex has nothing to fall back to", async () => {
    const store = memoryStore({ settings: { baseUrl: "", token: "kx_abc", mockMode: true } });
    expect((await loadSettings(store)).baseUrl).toBe("");
  });
  it("persists patches", async () => {
    const store = memoryStore();
    await saveSettings(store, { mockMode: false, baseUrl: "https://k.dev" });
    expect(await loadSettings(store)).toMatchObject({ mockMode: false, baseUrl: "https://k.dev", highlighterEnabled: true });
  });
  it("validates base URLs", () => {
    expect(normalizeBaseUrl("https://kortex.example.com/")).toBe("https://kortex.example.com");
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBaseUrl("http://example.com")).toBeNull();
    expect(normalizeBaseUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBaseUrl("nonsense")).toBeNull();
    expect(normalizeBaseUrl("  ")).toBe("");
  });
});
