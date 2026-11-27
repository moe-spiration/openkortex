import { describe, expect, it } from "vitest";
import {
  blockedPageReason,
  createWebArticleAdapter,
  googleSearchQuery,
} from "../src/adapters/web-article.adapter";
import { fakeFetch, html, USER_ID } from "./helpers";

const zara =
  "https://www.zara.com/de/de/tri-chic-kleine-ledertasche-limited-edition-p16715810.html";
const shareHint = {
  title: "TRI-CHIC KLEINE LEDERTASCHE LIMITED EDITION",
  description: "Kleine Tasche aus Leder.",
  imageUrl: "https://static.zara.net/bag.jpg",
  siteName: "ZARA",
};

describe("blocked pages", () => {
  it("detects bot, consent and error pages", () => {
    expect(blockedPageReason("Access Denied", "")).toMatch(/blocked/);
    expect(blockedPageReason("Google Suche – Zugriffsfehler", "")).toMatch(/blocked/);
    expect(blockedPageReason("Just a moment...", "")).toMatch(/blocked/);
    expect(
      blockedPageReason(
        "Google",
        "Our systems have detected unusual traffic from your computer network.",
      ),
    ).toMatch(/blocked/);
    expect(blockedPageReason("Vorher", "Weiter zu consent.google.com/ml?continue=")).toMatch(
      /blocked/,
    );
    expect(
      blockedPageReason("Model Context Protocol erklärt", "Ein langer Artikel."),
    ).toBeUndefined();
  });

  it("saves a 403 page as a bookmark from the share data", async () => {
    const fetch = fakeFetch([
      {
        match: () => true,
        respond: () => html("<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>", 403),
      },
    ]);
    const out = await createWebArticleAdapter({ fetch }).extract({
      userId: USER_ID,
      url: zara,
      clientHint: shareHint,
    });
    expect(out.type).toBe("article");
    expect(out.titleHint).toBe(shareHint.title);
    expect(out.coverImageUrl).toBe(shareHint.imageUrl);
    expect(out.contentMd).toContain("> Kleine Tasche aus Leder.");
    expect(out.contentMd).toContain(`[ZARA](${zara})`);
    expect(out.metadata).toMatchObject({ extractor: "client", site: "ZARA" });
    // The direct fetch and the keyless reader both met the wall.
    expect(out.metadata.extraction_fallback_reasons).toEqual([
      expect.stringContaining("403"),
      expect.stringMatching(/^jina \(keyless\):.*403/),
    ]);
  });

  it("does not keep a 200 block page as content", async () => {
    const block = `<html><head><title>Access Denied</title><meta property="og:description" content="x"></head><body>${"You don't have permission to access this server. ".repeat(10)}</body></html>`;
    const fetch = fakeFetch([{ match: () => true, respond: () => html(block) }]);
    const out = await createWebArticleAdapter({ fetch }).extract({
      userId: USER_ID,
      url: zara,
      clientHint: shareHint,
    });
    expect(out.metadata.extractor).toBe("client");
    expect(out.contentMd).not.toContain("permission");
  });

  it("fails when blocked and the client sent no usable title", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => html("denied", 403) }]);
    await expect(
      createWebArticleAdapter({ fetch }).extract({
        userId: USER_ID,
        url: zara,
        clientHint: { title: "Access Denied" },
      }),
    ).rejects.toThrow(/could not extract/);
  });
});

describe("Google search URLs", () => {
  it("become a note without fetching", async () => {
    const url = "https://www.google.com/search?q=12+12+12+serie+start&client=ms-android";
    expect(googleSearchQuery(url)).toBe("12 12 12 serie start");
    expect(googleSearchQuery("https://www.google.de/maps?q=x")).toBeUndefined();
    const fetch = fakeFetch([]);
    const out = await createWebArticleAdapter({ fetch }).extract({ userId: USER_ID, url });
    expect(fetch.calls).toEqual([]);
    expect(out.type).toBe("note");
    expect(out.titleHint).toBe("Google-Suche: 12 12 12 serie start");
    expect(out.contentMd).toBe(
      `# Google-Suche: 12 12 12 serie start\n\n[12 12 12 serie start](${url})`,
    );
  });
});
