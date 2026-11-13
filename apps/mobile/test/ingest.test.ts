import { describe, expect, it, vi } from "vitest";
import { createApiClient, mockIngest, requestFromShare, validateIngestRequest, type IngestSettings, type IngestSuccess } from "../src/api/ingest";

const NOW = new Date("2026-10-22T11:19:00Z");
const settings = (over: Partial<IngestSettings> = {}): IngestSettings => ({ mockMode: true, baseUrl: "", token: "", ...over });

describe("requestFromShare", () => {
  it("turns a shared link into a web_clip", () => {
    const r = requestFromShare({ webUrl: "https://www.instagram.com/reel/abc", title: "Hyrox Sled Push" }, "0.1.0", NOW);
    expect(r).toMatchObject({
      kind: "web_clip",
      url: "https://www.instagram.com/reel/abc",
      title: "Hyrox Sled Push",
      site_name: "instagram.com",
      captured_at: NOW.toISOString(),
      client: { name: "kortex-mobile", version: "0.1.0" },
    });
  });

  it("finds the link inside shared text and keeps the rest as note", () => {
    const r = requestFromShare({ text: "Lesenswert!\nhttps://example.com/artikel" }, "0.1.0", NOW);
    expect(r).toMatchObject({ kind: "web_clip", url: "https://example.com/artikel", note: "Lesenswert!" });
  });

  it("turns plain text into a note and ignores empty shares", () => {
    expect(requestFromShare({ text: "Idee: Gardener mit Kontext" }, "0.1.0", NOW)).toMatchObject({ kind: "note", content_md: "Idee: Gardener mit Kontext" });
    expect(requestFromShare({ text: "  " }, "0.1.0", NOW)).toBeNull();
  });
});

describe("validation", () => {
  it("matches the server contract", () => {
    expect(validateIngestRequest({ kind: "web_clip", url: "ftp://x", title: "t" })).toMatch(/http/);
    expect(validateIngestRequest({ kind: "web_clip", url: "https://x.de", title: "" })).toMatch(/title/);
    expect(validateIngestRequest({ kind: "note", content_md: "" })).toMatch(/content_md/);
    expect(validateIngestRequest({ kind: "note", content_md: "x" })).toBeNull();
    expect(validateIngestRequest({ kind: "highlight" })).toMatch(/unknown/);
  });
});

describe("api client", () => {
  const clip = requestFromShare({ webUrl: "https://example.com/a", title: "A" }, "0.1.0", NOW)!;

  it("answers locally in mock mode without touching the network", async () => {
    const fetchImpl = vi.fn();
    const api = createApiClient({ getSettings: () => settings(), fetchImpl: fetchImpl as never, now: () => NOW });
    const res = await api.ingest(clip);
    expect(res).toMatchObject({ ok: true, kind: "web_clip", type: "bookmark", status: "inbox", folder_path: "00_Inbox", auto_routed: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockIngest({ kind: "file", name: "Plan.pdf" }, NOW).type).toBe("pdf");
  });

  it("posts JSON with the bearer token to /api/ingest", async () => {
    const success: IngestSuccess = { ok: true, kind: "web_clip", item_id: "i1", type: "bookmark", status: "inbox", folder_path: "00_Inbox", auto_routed: true, duplicate: false };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(success), { status: 200 }));
    const api = createApiClient({ getSettings: () => settings({ mockMode: false, baseUrl: "https://kortex.example.com", token: "tok" }), fetchImpl: fetchImpl as never });
    expect(await api.ingest(clip)).toEqual(success);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://kortex.example.com/api/ingest");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: "web_clip", url: "https://example.com/a" });
  });

  it("reports missing configuration, auth and network failures", async () => {
    const unconfigured = createApiClient({ getSettings: () => settings({ mockMode: false }) });
    expect(await unconfigured.ingest(clip)).toMatchObject({ ok: false, error: { code: "not_configured" } });

    const denied = createApiClient({
      getSettings: () => settings({ mockMode: false, baseUrl: "https://k.de", token: "t" }),
      fetchImpl: (async () => new Response("{}", { status: 401 })) as never,
    });
    expect(await denied.ingest(clip)).toMatchObject({ ok: false, error: { code: "unauthorized" } });

    const offline = createApiClient({
      getSettings: () => settings({ mockMode: false, baseUrl: "https://k.de", token: "t" }),
      fetchImpl: (async () => {
        throw new TypeError("fail");
      }) as never,
    });
    expect(await offline.ingest(clip)).toMatchObject({ ok: false, error: { code: "network" } });
  });
});

describe("google search shares", () => {
  it("become a note with the query", async () => {
    const { requestFromShare, googleQuery } = await import("../src/api/ingest");
    const url = "https://www.google.com/search?q=12+12+12+serie+start&client=ms-android-google";
    expect(googleQuery(url)).toBe("12 12 12 serie start");
    expect(googleQuery("https://www.google.de/maps?q=x")).toBeNull();
    const r = requestFromShare({ text: url }, "0");
    expect(r).toMatchObject({ kind: "note", title: "Google-Suche: 12 12 12 serie start" });
  });
});
