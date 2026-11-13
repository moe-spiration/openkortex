import { describe, expect, it, vi } from "vitest";
import { appendActivity, applyStatus, isOpen, readActivity, toActivity } from "../src/lib/activity";
import { createApiClient, mockIngest, type IngestResponse, type IngestSuccess } from "../src/lib/api";
import { createOutbox } from "../src/lib/outbox";
import { buildWebClip } from "../src/lib/requests";
import { describeAccepted, describePipeline } from "../src/lib/result";
import { DEFAULT_SETTINGS, memoryStore, type ExtensionSettings } from "../src/lib/settings";

// Production wiring: the configured Kortex, personal kx_ token, automatic live mode, and the server's
// answers (ping, status, folder, replay) reaching the UI helpers.

const TOKEN = "kx_" + "a".repeat(43);
const page = { url: "https://example.com/a", title: "Artikel", description: null, image_url: null, site_name: null, domain: "example.com", reading_minutes: null, keywords: [] };
const clip = () => buildWebClip(page, { folder: null, tags: [], note: "" });
const settings = (over: Partial<ExtensionSettings> = {}) => async () => ({ ...DEFAULT_SETTINGS, baseUrl: "https://kortex.example.com", ...over });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const accepted: IngestSuccess = {
  ok: true,
  kind: "web_clip",
  item_id: "i1",
  type: "bookmark",
  status: "inbox",
  folder_path: "00_Inbox",
  auto_routed: true,
  duplicate: false,
  queued: true,
};

describe("automatic mode and the configured URL", () => {
  it("sends to https://kortex.example.com/api/ingest with the personal token as soon as one is set", async () => {
    const fetchImpl = vi.fn(async () => json(200, accepted));
    const api = createApiClient({ getSettings: settings({ token: ` ${TOKEN} ` }), fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await api.ingest(clip());
    expect(res).toMatchObject({ ok: true, item_id: "i1", auto_routed: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://kortex.example.com/api/ingest");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe("omit");
  });

  it("stays local (mock) without a token and never calls fetch", async () => {
    const fetchImpl = vi.fn();
    const recorded: unknown[] = [];
    const api = createApiClient({
      getSettings: settings(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      recordMock: async (e) => void recorded.push(e),
    });
    const res = await api.ingest(clip());
    expect(res.ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
  });

  it("an explicit mock choice keeps a token from going out", async () => {
    const fetchImpl = vi.fn();
    const api = createApiClient({ getSettings: settings({ token: TOKEN, mockMode: true }), fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.ingest(clip());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the server's reason for a revoked token", async () => {
    const fetchImpl = vi.fn(async () => json(401, { ok: false, error: { code: "unauthorized", message: "API-Token wurde widerrufen" } }));
    const api = createApiClient({ getSettings: settings({ token: TOKEN }), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await api.ingest(clip())).toEqual({ ok: false, error: { code: "unauthorized", message: "API-Token wurde widerrufen" } });
  });
});

describe("ping (Verbindung testen)", () => {
  it("reports the token name", async () => {
    const fetchImpl = vi.fn(async () => json(200, { ok: true, user_id: "u1", token_name: "Laptop" }));
    const api = createApiClient({ getSettings: settings({ token: TOKEN, mockMode: false }), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await api.ping()).toEqual({ ok: true, data: { user_id: "u1", token_name: "Laptop" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://kortex.example.com/api/ingest");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("maps failures: setup, rejected token, unreachable", async () => {
    const none = createApiClient({ getSettings: settings() });
    expect(await none.ping()).toMatchObject({ ok: false, error: { code: "setup_required" } });

    const denied = createApiClient({
      getSettings: settings({ token: TOKEN }),
      fetchImpl: (async () => json(403, { ok: false, error: { code: "unauthorized", message: "Konto nicht freigeschaltet" } })) as unknown as typeof fetch,
    });
    expect(await denied.ping()).toMatchObject({ ok: false, error: { code: "unauthorized", message: "Konto nicht freigeschaltet" } });

    const down = createApiClient({
      getSettings: settings({ token: TOKEN }),
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    expect(await down.ping()).toMatchObject({ ok: false, error: { code: "network" } });
  });
});

describe("status", () => {
  it("asks the server for the item and returns its final folder", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { ok: true, user_id: "u1", item: { item_id: "i1", status: "processed", type: "article", title: "Artikel", folder_path: "30_Clippings/AI" } }),
    );
    const api = createApiClient({ getSettings: settings({ token: TOKEN }), fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await api.status("i1");
    expect(res).toMatchObject({ ok: true, data: { status: "processed", folder_path: "30_Clippings/AI" } });
    expect(String((fetchImpl.mock.calls[0] as unknown as [URL])[0])).toBe("https://kortex.example.com/api/ingest?item_id=i1");
  });

  it("does not call the network in mock mode", async () => {
    const fetchImpl = vi.fn();
    const api = createApiClient({ getSettings: settings(), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await api.status("mock-1")).ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("server results as UI text", () => {
  it("auto-routed, merged and replayed captures", () => {
    expect(describeAccepted(accepted)).toMatchObject({ headline: "In Kortex Inbox gespeichert", placement: expect.stringContaining("automatisch ein (vorerst 00_Inbox)") });
    expect(describeAccepted({ ...accepted, auto_routed: false, folder_path: "30_Clippings" }).placement).toBe("Abgelegt in 30_Clippings");
    expect(describeAccepted({ ...accepted, duplicate: true }).headline).toMatch(/zusammengeführt/);
    expect(describeAccepted({ ...accepted, replayed: true })).toMatchObject({ headline: "Schon angekommen" });
  });

  it("pipeline states", () => {
    expect(describePipeline({ status: "processing", folder_path: "00_Inbox" })).toMatchObject({ tone: "warn", final: false });
    expect(describePipeline({ status: "processed", folder_path: "30_Clippings/AI" })).toMatchObject({ tone: "ok", label: "Verarbeitet", detail: "Einsortiert in 30_Clippings/AI", final: true });
    expect(describePipeline({ status: "error", folder_path: "00_Inbox", error: "Seite nicht lesbar." })).toMatchObject({ tone: "error", final: true, detail: expect.stringContaining("Seite nicht lesbar.") });
  });
});

describe("activity log", () => {
  it("records the server's answer, replaces repeats and follows the pipeline", async () => {
    const store = memoryStore();
    const req = clip();
    await appendActivity(store, toActivity(req, accepted, "2026-10-24T08:00:00.000Z"));
    await appendActivity(store, toActivity(req, { ...accepted, replayed: true }, "2026-10-24T08:01:00.000Z"));
    let log = await readActivity(store);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ title: "Artikel", replayed: true, status: "inbox", folder_path: "00_Inbox" });
    expect(isOpen(log[0]!)).toBe(true);

    await applyStatus(store, { item_id: "i1", status: "processed", type: "article", title: "Artikel", folder_path: "30_Clippings/AI" });
    log = await readActivity(store);
    expect(log[0]).toMatchObject({ status: "processed", folder_path: "30_Clippings/AI" });
    expect(isOpen(log[0]!)).toBe(false);
  });

  it("keeps the 20 newest", async () => {
    const store = memoryStore();
    for (let i = 0; i < 25; i++) await appendActivity(store, toActivity(clip(), { ...accepted, item_id: `i${i}` }, `2026-10-24T08:${String(i).padStart(2, "0")}:00.000Z`));
    const log = await readActivity(store);
    expect(log).toHaveLength(20);
    expect(log[0]!.item_id).toBe("i24");
  });
});

describe("outbox delivery hook and queue management", () => {
  it("reports live deliveries, also those that succeed on a later retry", async () => {
    const store = memoryStore();
    const answers: IngestResponse[] = [
      { ok: false, error: { code: "network", message: "Kortex ist nicht erreichbar" } },
      accepted,
    ];
    const delivered: string[] = [];
    let t = 1_000_000;
    const outbox = createOutbox({
      store,
      api: { ingest: async () => answers.shift()! },
      now: () => t,
      newId: () => "q1",
      onDelivered: async (_req, res) => void delivered.push(res.item_id),
    });
    expect(await outbox.submit(clip())).toMatchObject({ ok: true, delivered: false, queued: true });
    expect(delivered).toEqual([]);
    t += 60 * 60_000;
    expect(await outbox.flush()).toMatchObject({ delivered: 1, pending: 0 });
    expect(delivered).toEqual(["i1"]);
  });

  it("a failing hook never fails the capture", async () => {
    const outbox = createOutbox({
      store: memoryStore(),
      api: { ingest: async () => mockIngest(clip()) },
      onDelivered: async () => {
        throw new Error("storage full");
      },
    });
    expect(await outbox.submit(clip())).toMatchObject({ ok: true, delivered: true });
  });

  it("lets the user drop a queued capture", async () => {
    const outbox = createOutbox({
      store: memoryStore(),
      api: { ingest: async () => ({ ok: false, error: { code: "network", message: "x" } }) },
      newId: () => "q1",
    });
    await outbox.submit(clip());
    expect(await outbox.size()).toBe(1);
    await outbox.remove("q1");
    expect(await outbox.size()).toBe(0);
  });
});
