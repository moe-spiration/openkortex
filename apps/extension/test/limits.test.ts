import { describe, expect, it } from "vitest";
import type { AiChatRequest, HighlightRequest, IngestRequest, WebClipRequest } from "../src/lib/api";
import {
  LIMITS,
  applyLimits,
  fitImageUrl,
  fitTags,
  fitTranscript,
  fitUrl,
  truncate,
} from "../src/lib/limits";

const base = { client: { name: "kortex-extension" as const, version: "0.1.0" }, captured_at: "2026-10-23T08:00:00Z" };
const clip = (over: Partial<WebClipRequest> = {}): WebClipRequest => ({
  ...base,
  kind: "web_clip",
  url: "https://a.dev/x",
  title: "Titel",
  ...over,
});
const hl = (over: Partial<HighlightRequest> = {}): HighlightRequest => ({
  ...base,
  kind: "highlight",
  url: "https://a.dev/x",
  page_title: "Seite",
  quote_text: "Zitat",
  locator: {
    v: 1,
    quote: { exact: "Zitat", prefix: "", suffix: "" },
    position: { start: 0, end: 5 },
    range: { startXPath: "/p[1]/text()[1]", startOffset: 0, endXPath: "/p[1]/text()[1]", endOffset: 5 },
  },
  ...over,
});
const chat = (over: Partial<AiChatRequest> = {}): AiChatRequest => ({
  ...base,
  kind: "ai_chat",
  platform: "claude",
  scope: "chat",
  url: "https://claude.ai/chat/1",
  title: "Chat",
  content_md: "### User\n\nhi",
  message_count: 1,
  folder_path: "40_AI_Memories",
  ...over,
});

describe("primitives", () => {
  it("truncates with an ellipsis within the limit", () => {
    expect(truncate("abc", 5)).toEqual({ value: "abc", cut: false });
    const r = truncate("a".repeat(600), 500);
    expect(r.cut).toBe(true);
    expect(r.value).toHaveLength(500);
    expect(r.value.endsWith("…")).toBe(true);
  });

  it("keeps only http(s) image URLs of sane length", () => {
    expect(fitImageUrl("https://cdn.a.dev/i.png")).toBe("https://cdn.a.dev/i.png");
    expect(fitImageUrl("http://cdn.a.dev/i.png")).toBe("http://cdn.a.dev/i.png");
    expect(fitImageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(fitImageUrl("blob:https://a.dev/uuid")).toBeNull();
    expect(fitImageUrl("javascript:alert(1)")).toBeNull();
    expect(fitImageUrl("/relative.png")).toBeNull();
    expect(fitImageUrl(`https://a.dev/${"x".repeat(LIMITS.imageUrl)}`)).toBeNull();
    expect(fitImageUrl(null)).toBeNull();
  });

  it("shortens over-long page URLs by dropping fragment, then query", () => {
    expect(fitUrl("https://a.dev/p?x=1")).toBe("https://a.dev/p?x=1");
    const longQuery = `https://a.dev/p?q=${"x".repeat(LIMITS.url)}#frag`;
    expect(fitUrl(longQuery)).toBe("https://a.dev/p");
    expect(fitUrl(`https://a.dev/${"x".repeat(LIMITS.url)}`)).toBeNull();
    expect(fitUrl("nonsense ".repeat(1000))).toBeNull();
  });

  it("cuts transcripts at a message boundary and says so", () => {
    const md = ["### User\n\n" + "a".repeat(60), "### Assistant\n\n" + "b".repeat(60), "### User\n\n" + "c".repeat(60)].join("\n\n");
    const r = fitTranscript(md, 200);
    expect(r.cut).toBe(true);
    expect(r.value.length).toBeLessThanOrEqual(200);
    // whole messages only: the second one does not fit completely, so it is dropped entirely
    expect(r.value.startsWith(`### User\n\n${"a".repeat(60)}`)).toBe(true);
    expect(r.value).not.toContain("### Assistant");
    expect(r.value).not.toContain("b");
    expect(r.value).toMatch(/> Hinweis: Export gekürzt \(Limit 200 Zeichen\)$/);
    expect(fitTranscript(md, 10_000)).toEqual({ value: md, cut: false });
  });

  it("limits tag count and length and removes duplicates", () => {
    const tags = fitTags([" a ", "a", "b".repeat(LIMITS.tagLength + 1), ...Array.from({ length: 40 }, (_, i) => `t${i}`)])!;
    expect(tags).toHaveLength(LIMITS.tags);
    expect(tags[0]).toBe("a");
    expect(tags.every((t) => t.length <= LIMITS.tagLength)).toBe(true);
    expect(fitTags(undefined)).toBeUndefined();
  });
});

describe("applyLimits", () => {
  it("leaves compliant requests untouched and silent", () => {
    for (const r of [clip({ description: "d", note: "n", tags: ["ai/mcp"] }), hl(), chat()]) {
      const f = applyLimits(r as IngestRequest);
      expect(f.error).toBeUndefined();
      expect(f.notices).toEqual([]);
      expect(f.request).toMatchObject({ kind: r.kind, url: r.url });
    }
  });

  it("trims clip fields, tells the user, and drops a data: preview image silently", () => {
    const f = applyLimits(
      clip({
        title: "T".repeat(700),
        description: "D".repeat(6000),
        note: "N".repeat(25_000),
        image_url: "data:image/png;base64,AAAA",
        site_name: "S".repeat(300),
      }),
    );
    const r = f.request as WebClipRequest;
    expect(r.title).toHaveLength(LIMITS.title);
    expect(r.description).toHaveLength(LIMITS.description);
    expect(r.note).toHaveLength(LIMITS.note);
    expect(r.site_name).toHaveLength(LIMITS.siteName);
    expect(r.image_url).toBeNull();
    expect(f.notices).toEqual([
      "Titel auf 500 Zeichen gekürzt",
      "Beschreibung auf 5.000 Zeichen gekürzt",
      "Notiz auf 20.000 Zeichen gekürzt",
    ]);
  });

  it("does not mutate its input and keeps the idempotency key", () => {
    const input = clip({ title: "T".repeat(700), idempotency_key: "key-0123456789" });
    const f = applyLimits(input);
    expect(input.title).toHaveLength(700);
    expect((f.request as WebClipRequest).idempotency_key).toBe("key-0123456789");
  });

  it("falls back to the bare URL, or reports an error when even that is too long", () => {
    const f = applyLimits(clip({ url: `https://a.dev/p?q=${"x".repeat(LIMITS.url)}` }));
    expect((f.request as WebClipRequest).url).toBe("https://a.dev/p");
    expect(f.notices).toContain("Adresse ohne Parameter gespeichert (zu lang)");
    const bad = applyLimits(clip({ url: `https://a.dev/${"x".repeat(LIMITS.url)}` }));
    expect(bad.error).toMatch(/Adresse/);
  });

  it("rejects an oversized folder path and an oversized selection", () => {
    expect(applyLimits(clip({ folder_path: "f".repeat(LIMITS.folderPath + 1) })).error).toMatch(/Ordnerpfad/);
    expect(applyLimits(hl({ quote_text: "q".repeat(LIMITS.quote + 1) })).error).toMatch(/Auswahl/);
  });

  it("trims highlight metadata", () => {
    const f = applyLimits(hl({ page_title: "P".repeat(900), note_text: "n".repeat(LIMITS.noteText + 5) }));
    expect((f.request as HighlightRequest).page_title).toHaveLength(LIMITS.title);
    expect((f.request as HighlightRequest).note_text).toHaveLength(LIMITS.noteText);
    expect(f.notices).toHaveLength(2);
  });

  it("shortens a 2 MB+ chat at a message boundary", () => {
    const turn = (role: string, n: number) => `### ${role}\n\n${"x".repeat(n)}`;
    const md = [turn("User", 1_000_000), turn("Assistant", 900_000), turn("User", 400_000), turn("Assistant", 400_000)].join("\n\n");
    const f = applyLimits(chat({ content_md: md, title: "T".repeat(800) }));
    const r = f.request as AiChatRequest;
    expect(md.length).toBeGreaterThan(LIMITS.contentMd);
    expect(r.content_md.length).toBeLessThanOrEqual(LIMITS.contentMd);
    expect(r.content_md).toContain("Hinweis: Export gekürzt");
    expect(r.title).toHaveLength(LIMITS.title);
    expect(f.notices).toEqual(["Chat auf 2.000.000 Zeichen gekürzt (Rest entfällt)", "Titel auf 500 Zeichen gekürzt"]);
  });
});
