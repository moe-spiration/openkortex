import { describe, expect, it, vi } from "vitest";
import {
  AI_MEMORIES_FOLDER,
  createApiClient,
  memoryFileName,
  mockIngest,
  slugify,
  validateIngestRequest,
  type IngestRequest,
  type MockInboxEntry,
} from "../src/lib/api";
import { buildAiChat, buildHighlight, buildWebClip } from "../src/lib/requests";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/lib/settings";

const NOW = new Date("2026-10-23T09:30:00.000Z");
const page = {
  url: "https://engineering-notes.dev/contextual-retrieval",
  title: "Contextual Retrieval in der Praxis",
  description: "RAG",
  image_url: "https://engineering-notes.dev/og.png",
  site_name: "Engineering Notes",
  domain: "engineering-notes.dev",
  reading_minutes: 8,
  keywords: [],
};
const locator = {
  v: 1 as const,
  quote: { exact: "x", prefix: "", suffix: "" },
  position: { start: 0, end: 1 },
  range: { startXPath: "/a", startOffset: 0, endXPath: "/a", endOffset: 1 },
};
const clip = () => buildWebClip(page, { folder: null, tags: ["ai/mcp"], note: " warum " }, NOW);
const chat = () =>
  buildAiChat(
    { platform: "claude", scope: "chat", url: "https://claude.ai/chat/1", title: "RAG und Chunking", content_md: "### User\n\nhi", message_count: 1 },
    NOW,
  );
const settings = (over: Partial<ExtensionSettings> = {}) => async () => ({ ...DEFAULT_SETTINGS, ...over });
const live = { mockMode: false, baseUrl: "https://kortex.example.com", token: "secret-token" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("request builders", () => {
  it("builds a web clip with auto-routing and a trimmed note", () => {
    expect(clip()).toMatchObject({
      kind: "web_clip",
      client: { name: "kortex-extension" },
      captured_at: NOW.toISOString(),
      folder_path: null,
      note: "warum",
      tags: ["ai/mcp"],
      type_hint: "article",
    });
  });
  it("builds ai_chat requests for 40_AI_Memories and highlights", () => {
    expect(chat()).toMatchObject({ kind: "ai_chat", folder_path: AI_MEMORIES_FOLDER, tags: ["ai/agent-memory", "ai/claude"] });
    expect(buildHighlight(page, "x", locator, NOW)).toMatchObject({ kind: "highlight", quote_text: "x", color: "yellow" });
  });
});

describe("validateIngestRequest", () => {
  it("accepts well-formed requests", () => {
    for (const r of [clip(), chat(), buildHighlight(page, "x", locator, NOW)]) expect(validateIngestRequest(r)).toBeNull();
  });
  it("rejects malformed ones", () => {
    expect(validateIngestRequest(null)).toMatch(/object/);
    expect(validateIngestRequest({ ...clip(), url: "javascript:alert(1)" })).toMatch(/http/);
    expect(validateIngestRequest({ ...clip(), kind: "nope" })).toMatch(/kind/);
    expect(validateIngestRequest({ ...clip(), title: "" })).toMatch(/title/);
    expect(validateIngestRequest({ ...chat(), platform: "bard" })).toMatch(/platform/);
    expect(validateIngestRequest({ ...chat(), folder_path: "10_Notes" })).toMatch(/40_AI_Memories/);
    expect(validateIngestRequest({ ...buildHighlight(page, "x", locator, NOW), locator: {} })).toMatch(/locator/);
  });
});

describe("mock mode", () => {
  it("is the default: never touches the network and records the capture", async () => {
    const fetchImpl = vi.fn();
    const recorded: MockInboxEntry[] = [];
    const api = createApiClient({ getSettings: settings(), fetchImpl, recordMock: async (e) => void recorded.push(e), now: () => NOW });
    const res = await api.ingest(clip());
    expect(res).toMatchObject({ ok: true, kind: "web_clip", status: "inbox", folder_path: "00_Inbox", auto_routed: true, duplicate: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
  });

  it("answers per kind", () => {
    expect(mockIngest({ ...clip(), folder_path: "30_Clippings" }, NOW)).toMatchObject({ folder_path: "30_Clippings", auto_routed: false });
    expect(mockIngest(chat(), NOW)).toMatchObject({ type: "ai_chat", folder_path: "40_AI_Memories", file: "2026-10-23_rag-und-chunking.md" });
    expect(mockIngest(buildHighlight(page, "x", locator, NOW), NOW).highlight_id).toBeTruthy();
  });

  it("validates before answering", async () => {
    const api = createApiClient({ getSettings: settings() });
    expect(await api.ingest({ ...clip(), url: "ftp://x" })).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });
});

describe("live mode", () => {
  const success = { ok: true, kind: "web_clip", item_id: "i1", type: "article", status: "inbox", folder_path: "00_Inbox", auto_routed: true, duplicate: false };

  it("POSTs JSON with the bearer token to /api/ingest", async () => {
    const fetchImpl = vi.fn(async () => json(200, success));
    const api = createApiClient({ getSettings: settings(live), fetchImpl: fetchImpl as unknown as typeof fetch });
    const req: IngestRequest = clip();
    const res = await api.ingest(req);
    expect(res).toEqual(success);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://kortex.example.com/api/ingest");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-token", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(req);
  });

  it("keeps a base URL path prefix", async () => {
    const fetchImpl = vi.fn(async () => json(200, success));
    const api = createApiClient({ getSettings: settings({ ...live, baseUrl: "https://host.dev/kortex" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.ingest(clip());
    expect(String((fetchImpl.mock.calls[0] as unknown as [URL])[0])).toBe("https://host.dev/api/ingest");
  });

  it("maps failures to typed errors", async () => {
    const run = async (resp: () => Response | Promise<Response>) => {
      const api = createApiClient({ getSettings: settings(live), fetchImpl: (async () => resp()) as unknown as typeof fetch });
      return api.ingest(clip());
    };
    expect(await run(() => json(401, { ok: false, error: { code: "unauthorized", message: "bad token" } }))).toEqual({ ok: false, error: { code: "unauthorized", message: "bad token" } });
    expect(await run(() => json(403, "nope"))).toMatchObject({ error: { code: "unauthorized" } });
    expect(await run(() => json(429, {}))).toMatchObject({ error: { code: "rate_limited" } });
    expect(await run(() => json(502, "<html>"))).toMatchObject({ error: { code: "server_error" } });
    expect(await run(() => json(400, {}))).toMatchObject({ error: { code: "invalid_request" } });
    expect(await run(() => json(200, { ok: true }))).toMatchObject({ ok: false });
    expect(await run(() => Promise.reject(new TypeError("Failed to fetch")))).toMatchObject({ error: { code: "network" } });
  });

  it("needs a URL and a token", async () => {
    const api = createApiClient({ getSettings: settings({ mockMode: false }) });
    expect(await api.ingest(clip())).toMatchObject({ error: { code: "setup_required" } });
    const api2 = createApiClient({ getSettings: settings({ mockMode: false, baseUrl: "https://x.dev" }) });
    expect(await api2.ingest(clip())).toMatchObject({ error: { code: "setup_required" } });
  });

  it("times out", async () => {
    const fetchImpl = ((_u: unknown, init: RequestInit) =>
      new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const api = createApiClient({ getSettings: settings(live), fetchImpl, timeoutMs: 10 });
    expect(await api.ingest(clip())).toMatchObject({ error: { code: "network", message: "Zeitüberschreitung" } });
  });
});

describe("naming", () => {
  it("slugifies like the MCP server", () => {
    expect(slugify("Größe & Überblick: RAG?")).toBe("grosse-uberblick-rag");
    expect(slugify("???")).toBe("untitled");
  });
  it("names memory files YYYY-MM-DD_topic-slug.md", () => {
    expect(memoryFileName("Chunk-Größe wählen", NOW)).toBe("2026-10-23_chunk-grosse-wahlen.md");
  });
});
