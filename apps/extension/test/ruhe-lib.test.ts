// Logic behind the Ruhe UI (2026-11-27): asking about the page (/api/chat stream), screenshot upload (multipart to
// /api/ingest), highlight colour and note, the four snooze points, the local index of captured pages, the tab
// manager's session suggestion and the page brightness check of the selection bar.
import { describe, expect, it, vi } from "vitest";
import { askKortex, buildAskBody, citedSources, createAskStreamParser } from "../src/lib/ask";
import { createApiClient, type HighlightLocator } from "../src/lib/api";
import { findCapture, pageKey, rememberCapture, updateCaptureFolder } from "../src/lib/captured";
import { parseCssColor, relativeLuminance } from "../src/lib/highlight/luminance";
import { remindChoices } from "../src/lib/remind";
import { buildHighlight } from "../src/lib/requests";
import { suggestSessionFit } from "../src/lib/session-suggest";
import { DEFAULT_SETTINGS, memoryStore, type ExtensionSettings } from "../src/lib/settings";

const live: ExtensionSettings = { ...DEFAULT_SETTINGS, mockMode: false, baseUrl: "https://kortex.example.com", token: "kx_secret" };
const ITEM = "11111111-1111-4111-8111-111111111111";
const sse = (...parts: unknown[]) => parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") + "data: [DONE]\n\n";
const stream = (text: string, chunk = 7) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });

describe("ask: stream parser", () => {
  it("joins text deltas across chunk borders and keeps the citations", () => {
    const p = createAskStreamParser();
    const body = sse(
      { type: "start" },
      { type: "text-start", id: "1" },
      { type: "text-delta", id: "1", delta: "Weil der " },
      { type: "text-delta", id: "1", delta: "Kontext fehlt [2]." },
      { type: "data-citations", data: { citations: [{ n: 1, item_id: "a", title: "A", extra: 1 }, { n: 2, item_id: "b", title: "B" }] } },
    );
    for (let i = 0; i < body.length; i += 5) p.push(body.slice(i, i + 5));
    const a = p.end();
    expect(a.text).toBe("Weil der Kontext fehlt [2].");
    expect(a.citations).toEqual([{ n: 1, item_id: "a", title: "A" }, { n: 2, item_id: "b", title: "B" }]);
    expect(citedSources(a)).toEqual([{ n: 2, item_id: "b", title: "B" }]);
    expect(a.error).toBeNull();
  });

  it("reports a stream error", () => {
    const p = createAskStreamParser();
    p.push(sse({ type: "error", errorText: "Modell nicht erreichbar" }));
    expect(p.end().error).toBe("Modell nicht erreichbar");
  });
});

describe("ask: request body", () => {
  const page = { url: "https://x.dev/a", title: "RAG", text: "Seitentext", quote: "Ein Satz" };

  it("asks the whole brain with the page in front of the first question while the page is not saved", () => {
    const body = buildAskBody([], "Warum?", page, "page");
    expect(body.mode).toBe("brain");
    expect(body).not.toHaveProperty("item_id");
    const q = body.messages[0]!.content;
    expect(q).toContain("„RAG“ (https://x.dev/a)");
    expect(q).toContain("„Ein Satz“");
    expect(q).toContain("Seitentext");
    expect(q.endsWith("Frage: Warum?")).toBe(true);
  });

  it("asks about the saved item (mode note) and leaves the page text out", () => {
    const body = buildAskBody([], "Warum?", { ...page, itemId: ITEM }, "page");
    expect(body).toMatchObject({ mode: "note", item_id: ITEM });
    expect(body.messages[0]!.content).not.toContain("Seitentext");
  });

  it("sends a follow-up and a library question as they are", () => {
    const history = [{ role: "user" as const, content: "x" }, { role: "assistant" as const, content: "y" }];
    expect(buildAskBody(history, "Und dann?", page, "page").messages.at(-1)).toEqual({ role: "user", content: "Und dann?" });
    expect(buildAskBody([], "Was weiß ich über RAG?", page, "library")).toEqual({ messages: [{ role: "user", content: "Was weiß ich über RAG?" }], mode: "brain" });
  });
});

describe("ask: askKortex", () => {
  const body = buildAskBody([], "Warum?", null, "library");

  it("posts to /api/chat with the token and streams the answer", async () => {
    const fetchImpl = vi.fn(async () => new Response(stream(sse({ type: "text-delta", delta: "Antwort" })), { status: 200 }));
    const updates: string[] = [];
    const res = await askKortex(body, { settings: live, fetchImpl: fetchImpl as unknown as typeof fetch, onUpdate: (a) => updates.push(a.text) });
    expect(res).toEqual({ ok: true, answer: { text: "Antwort", citations: [], error: null } });
    expect(updates.at(-1)).toBe("Antwort");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://kortex.example.com/api/chat");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer kx_secret");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("explains a token without the ask scope (403) and needs a connection", async () => {
    const forbidden = await askKortex(body, { settings: live, fetchImpl: (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch });
    expect(forbidden).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(forbidden.ok || forbidden.error.message).toContain("„Fragen“");
    const local = await askKortex(body, { settings: { ...live, mockMode: true } });
    expect(local).toMatchObject({ ok: false, error: { code: "setup_required" } });
  });
});

describe("api.uploadFile (screenshot)", () => {
  it("sends multipart/form-data with file, title, note and tags to /api/ingest", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, kind: "file", item_id: ITEM, type: "image", status: "processing", folder_path: "00_Inbox", auto_routed: true, duplicate: false }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = createApiClient({ getSettings: async () => live, fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await api.uploadFile(new Blob(["png"], { type: "image/png" }), "shot.png", { title: "Screenshot: RAG", note: "Diagramm", tags: ["ai/rag", "img"] });
    expect(res).toMatchObject({ ok: true, item_id: ITEM, type: "image" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://kortex.example.com/api/ingest");
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get("file") as File).name).toBe("shot.png");
    expect(form.get("title")).toBe("Screenshot: RAG");
    expect(form.get("note")).toBe("Diagramm");
    expect(form.get("tags")).toBe("ai/rag,img");
    // the browser sets the multipart boundary itself
    expect(new Headers(init.headers).get("Content-Type")).toBeNull();
  });

  it("answers locally in mock mode and refuses files over 50 MB", async () => {
    const api = createApiClient({ getSettings: async () => ({ ...live, mockMode: true }), fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(await api.uploadFile(new Blob(["x"]), "a.png", {})).toMatchObject({ ok: true, type: "image", folder_path: "00_Inbox" });
    const big = { size: 51 * 1024 * 1024 } as Blob;
    expect(await api.uploadFile(big, "a.png", {})).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });
});

describe("buildHighlight: colour and note", () => {
  const locator = { v: 1, quote: { exact: "x", prefix: "", suffix: "" }, position: { start: 0, end: 1 }, range: { startXPath: "", startOffset: 0, endXPath: "", endOffset: 1 } } as HighlightLocator;
  it("sends the chosen colour and a trimmed note; yellow without a choice", () => {
    const page = { url: "https://x.dev", title: "X" };
    expect(buildHighlight(page, "x", locator, new Date(), { color: "indigo", note: "  wichtig " })).toMatchObject({ color: "indigo", note_text: "wichtig" });
    const plain = buildHighlight(page, "x", locator);
    expect(plain.color).toBe("yellow");
    expect(plain).not.toHaveProperty("note_text");
  });
});

describe("remindChoices", () => {
  const hours = (iso: string) => new Date(iso).getHours();
  it("offers tonight 19:00, tomorrow 08:00, Saturday 10:00 and Monday 08:00 on a weekday morning", () => {
    const wed = new Date(2026, 10, 4, 10, 0);
    const [tonight, tomorrow, weekend, monday] = remindChoices(wed, "de-DE");
    expect([tonight!.key, tomorrow!.key, weekend!.key, monday!.key]).toEqual(["tonight", "tomorrow", "weekend", "next-week"]);
    expect(hours(tonight!.iso)).toBe(19);
    expect(new Date(tomorrow!.iso).getDate()).toBe(5);
    expect(new Date(weekend!.iso).getDay()).toBe(6);
    expect(hours(weekend!.iso)).toBe(10);
    expect(new Date(monday!.iso).getDate()).toBe(9);
    expect(tonight!.label).toBe("Heute Abend");
  });

  it("moves tonight to 21:00, then to the next evening, and the weekend to next Saturday on a Saturday", () => {
    expect(hours(remindChoices(new Date(2026, 10, 4, 20, 0))[0]!.iso)).toBe(21);
    const late = remindChoices(new Date(2026, 10, 4, 22, 0))[0]!;
    expect(new Date(late.iso).getDate()).toBe(5);
    const sat = remindChoices(new Date(2026, 10, 7, 9, 0))[2]!;
    expect(new Date(sat.iso).getDate()).toBe(14);
  });
});

describe("captured pages", () => {
  it("treats tracking parameters, the hash and a trailing slash as the same page", () => {
    expect(pageKey("https://x.dev/a/?utm_source=n&id=3#top")).toBe("https://x.dev/a?id=3");
    expect(pageKey("https://x.dev/")).toBe("https://x.dev/");
  });

  it("keeps the first capture time and follows the folder the pipeline settled on", async () => {
    const store = memoryStore();
    await rememberCapture(store, "https://x.dev/a", { item_id: ITEM, folder_path: "00_Inbox", at: "2026-11-01T08:00:00Z" });
    await rememberCapture(store, "https://x.dev/a?utm_medium=x", { item_id: ITEM, folder_path: "30_Clippings", at: "2026-11-02T08:00:00Z" });
    await updateCaptureFolder(store, ITEM, "30_Clippings/AI");
    expect(await findCapture(store, "https://x.dev/a#b")).toEqual({ item_id: ITEM, folder_path: "30_Clippings/AI", at: "2026-11-01T08:00:00Z" });
    expect(await findCapture(store, "https://x.dev/b")).toBeNull();
  });
});

describe("suggestSessionFit", () => {
  const session = { id: "s1", title: "Recherche RAG", saved_at: "", tabs: [{ url: "https://github.com/a" }, { url: "https://arxiv.org/abs/1" }] };
  it("proposes open tabs of the session's sites that are not in it yet", () => {
    const open = [{ url: "https://github.com/b" }, { url: "https://arxiv.org/abs/2" }, { url: "https://github.com/a" }, { url: "https://figma.com/" }, { url: "https://github.com/b" }];
    const fit = suggestSessionFit([session], open);
    expect(fit?.title).toBe("Recherche RAG");
    expect(fit?.tabs.map((x) => x.url)).toEqual(["https://github.com/b", "https://arxiv.org/abs/2"]);
  });

  it("stays quiet below the minimum, for pinned tabs and after a dismissal", () => {
    expect(suggestSessionFit([session], [{ url: "https://github.com/b" }])).toBeNull();
    expect(suggestSessionFit([session], [{ url: "https://github.com/b", pinned: true }, { url: "https://arxiv.org/abs/2", pinned: true }])).toBeNull();
    expect(suggestSessionFit([session], [{ url: "https://github.com/b" }, { url: "https://arxiv.org/abs/2" }], { dismissed: ["s1"] })).toBeNull();
  });
});

describe("page brightness", () => {
  it("parses computed colours and tells dark from light", () => {
    expect(parseCssColor("rgb(255, 255, 255)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("rgba(0, 0, 0, 0)")?.a).toBe(0);
    expect(parseCssColor("color(srgb 0 0 0 / 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull();
    expect(relativeLuminance({ r: 18, g: 18, b: 20 })).toBeLessThan(0.25);
    expect(relativeLuminance({ r: 250, g: 250, b: 247 })).toBeGreaterThan(0.25);
  });
});
