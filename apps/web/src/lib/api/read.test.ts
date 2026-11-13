import { afterEach, describe, expect, it, vi } from "vitest";
import { isAbort, readApi } from "./read";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readApi", () => {
  it("GETs /api/read/<name> with the query, no-store and same-origin cookies", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true, data: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await readApi("checkin", { date: "2026-10-25", tz: null });
    expect(r).toEqual({ ok: true, data: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/read/checkin?date=2026-10-25");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
  });

  it("passes the loader's error body through and maps a non-JSON 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, error: "kaputt" }, 500)));
    expect(await readApi("life")).toEqual({ ok: false, error: "kaputt" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    expect(await readApi("life")).toEqual({ ok: false, error: "Nicht angemeldet" });
  });

  it("a network failure resolves to ok: false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await readApi("status")).toEqual({ ok: false, error: "Keine Verbindung" });
  });

  it("an aborted read rejects with an AbortError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError"))))),
    );
    const ac = new AbortController();
    const p = readApi("home", { date: "2026-10-25" }, ac.signal);
    ac.abort();
    const err = await p.catch((e: unknown) => e);
    expect(isAbort(err)).toBe(true);
  });
});
