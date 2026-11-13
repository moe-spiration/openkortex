import { describe, expect, it } from "vitest";
import type { ApiClient, IngestRequest, IngestResponse } from "../src/lib/api";
import { createOutbox, readOutbox } from "../src/lib/outbox";
import { toastFor } from "../src/lib/page-toast";
import { buildWebClip } from "../src/lib/requests";
import { memoryStore } from "../src/lib/settings";

// Autosave reliability (feedback 0.6.2): a capture must survive the service worker stopping mid-request,
// and the page toast must say what happened.

const req = (): IngestRequest =>
  buildWebClip(
    { url: "https://a.dev/x", title: "T", description: null, image_url: null, site_name: null, domain: "a.dev", reading_minutes: null, keywords: [] },
    { folder: null, tags: [], note: "" },
  );
const ok: IngestResponse = { ok: true, kind: "web_clip", item_id: "1", type: "article", status: "inbox", folder_path: "00_Inbox", auto_routed: true, duplicate: false };

describe("outbox write-ahead", () => {
  it("has the capture on disk while the first request is still in flight", async () => {
    const store = memoryStore();
    let release!: (r: IngestResponse) => void;
    const api: Pick<ApiClient, "ingest"> = { ingest: () => new Promise((r) => (release = r)) };
    const outbox = createOutbox({ store, api, newId: () => "w1" });
    const pending = outbox.submit(req());
    await new Promise((r) => setTimeout(r, 0));
    const queued = await readOutbox(store);
    expect(queued).toHaveLength(1); // a worker stopped right now would not lose it
    expect(queued[0]!.attempts).toBe(0);
    release(ok);
    expect(await pending).toMatchObject({ ok: true, delivered: true });
    expect(await readOutbox(store)).toEqual([]);
  });

  it("delivers a written-ahead capture on the next flush after the worker died", async () => {
    const store = memoryStore();
    let t = 0;
    const dead = createOutbox({ store, api: { ingest: () => new Promise<IngestResponse>(() => undefined) }, now: () => t });
    void dead.submit(req()); // never answers: the worker is gone
    await new Promise((r) => setTimeout(r, 0));
    const calls: IngestRequest[] = [];
    const fresh = createOutbox({ store, api: { ingest: async (r) => (calls.push(r), ok) }, now: () => t });
    t += 61_000;
    expect(await fresh.flush()).toMatchObject({ delivered: 1, pending: 0 });
    expect(calls).toHaveLength(1);
  });

  it("turns a thrown request into a queued retry instead of losing it", async () => {
    const store = memoryStore();
    const outbox = createOutbox({ store, api: { ingest: () => Promise.reject(new TypeError("Failed to fetch")) } });
    expect(await outbox.submit(req())).toMatchObject({ ok: true, delivered: false, queued: true });
    expect((await readOutbox(store))[0]!.attempts).toBe(1);
  });
});

describe("page toast", () => {
  it("names the outcome", () => {
    expect(toastFor({ ok: true, delivered: true, response: { ...ok, ok: true } }, { pageTitle: "Artikel" })).toEqual({ tone: "ok", title: "In Kortex gespeichert", detail: "Artikel" });
    expect(toastFor({ ok: true, delivered: true, response: { ...ok, ok: true, duplicate: true } }).title).toBe("Schon in Kortex");
    expect(toastFor({ ok: true, delivered: false, queued: true, reason: "x" }).tone).toBe("warn");
    expect(toastFor({ ok: false, error: { code: "unauthorized", message: "Token ungültig" } })).toMatchObject({ tone: "error", detail: "Token ungültig" });
    expect(toastFor(null).tone).toBe("error");
    expect(toastFor({ ok: true, delivered: true, response: { ...ok, ok: true } }, { mock: true }).title).toBe("Lokal gespeichert");
  });
});
