import { describe, expect, it } from "vitest";
import { createApiClient } from "../src/lib/api";
import { rememberPendingClose, tabsStillToClose, takePendingClose } from "../src/lib/session-close";
import { DEFAULT_SETTINGS, memoryStore } from "../src/lib/settings";

describe("Speichern & schließen bei später Antwort", () => {
  it("closes only tabs that still show the saved page", () => {
    const pending = { tabs: [{ id: 1, url: "https://a.dev/" }, { id: 2, url: "https://b.dev/" }, { id: 3, url: "https://c.dev/" }] };
    expect(tabsStillToClose(pending, [{ id: 1, url: "https://a.dev/" }, { id: 2, url: "https://elsewhere.dev/" }])).toEqual([1]);
  });

  it("treats #fragments and a trailing slash as the same page (players and SPAs rewrite them)", () => {
    const pending = { tabs: [{ id: 1, url: "https://a.dev/doc" }, { id: 2, url: "https://b.dev/?v=1" }, { id: 3, url: "https://c.dev/x" }] };
    const now = [{ id: 1, url: "https://a.dev/doc/#kapitel-2" }, { id: 2, url: "https://b.dev/?v=2" }, { id: 3, url: "https://c.dev/x#t=30" }];
    expect(tabsStillToClose(pending, now)).toEqual([1, 3]);
  });

  it("hands a pending close out once, and not when it is stale", async () => {
    const s = memoryStore();
    await rememberPendingClose(s, { key: "k1", windowId: 7, tabs: [{ id: 1, url: "https://a.dev/" }], at: Date.now() });
    expect((await takePendingClose(s, "k1"))?.windowId).toBe(7);
    expect(await takePendingClose(s, "k1")).toBeNull();
    await rememberPendingClose(s, { key: "old", windowId: 7, tabs: [], at: Date.now() });
    expect(await takePendingClose(s, "old", Date.now() + 7 * 3_600_000)).toBeNull();
  });
});

describe("Highlight entfernen", () => {
  const settings = { ...DEFAULT_SETTINGS, mockMode: false, token: "kx_test", baseUrl: "https://kortex.example.com" };
  it("posts the delete to /api/highlight and treats 404 as removed", async () => {
    const calls: { url: string; body: unknown }[] = [];
    let status = 200;
    const api = createApiClient({
      getSettings: async () => settings,
      fetchImpl: (async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(status === 200 ? { ok: true } : { ok: false, error: { code: "not_found", message: "x" } }), { status });
      }) as unknown as typeof fetch,
    });
    expect(await api.deleteHighlight("11111111-1111-4111-8111-111111111111")).toEqual({ ok: true, data: { deleted: true } });
    expect(calls[0]).toEqual({ url: "https://kortex.example.com/api/highlight", body: { highlight_id: "11111111-1111-4111-8111-111111111111", action: "delete" } });
    status = 404;
    expect((await api.deleteHighlight("11111111-1111-4111-8111-111111111111")).ok).toBe(true);
  });

  it("answers locally in mock mode", async () => {
    const api = createApiClient({ getSettings: async () => ({ ...settings, mockMode: true }), fetchImpl: (() => { throw new Error("no network"); }) as unknown as typeof fetch });
    expect((await api.deleteHighlight("x")).ok).toBe(true);
  });
});
