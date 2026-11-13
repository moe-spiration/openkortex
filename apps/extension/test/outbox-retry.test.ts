import { describe, expect, it } from "vitest";
import type { ApiClient, IngestRequest, IngestResponse } from "../src/lib/api";
import { createOutbox } from "../src/lib/outbox";
import { buildAiChat, buildHighlight, buildWebClip } from "../src/lib/requests";
import { memoryStore } from "../src/lib/settings";

const page = { url: "https://a.dev/x", title: "T", description: null, image_url: null, site_name: null, domain: "a.dev", reading_minutes: null, keywords: [] };
const clip = (over: Partial<Parameters<typeof buildWebClip>[1]> = {}) => buildWebClip(page, { folder: null, tags: [], note: "", ...over });
const ok: IngestResponse = { ok: true, kind: "web_clip", item_id: "1", type: "bookmark", status: "inbox", folder_path: "00_Inbox", auto_routed: true, duplicate: false };
const fail = (code: "network" | "not_configured" | "server_error" | "unauthorized" | "invalid_request", message: string = code): IngestResponse => ({ ok: false, error: { code, message } });

function setup(responses: IngestResponse[]) {
  const store = memoryStore();
  const calls: IngestRequest[] = [];
  const api: Pick<ApiClient, "ingest"> = { ingest: async (r) => (calls.push(r), responses.shift() ?? ok) };
  let t = 1_000_000;
  let n = 0;
  const outbox = createOutbox({ store, api, now: () => t, newId: () => `id${++n}` });
  return { outbox, store, calls, advance: (ms: number) => (t += ms) };
}

describe("not_configured (HTTP 503) is retried", () => {
  it("queues the capture and delivers it once the server is configured", async () => {
    const { outbox, advance, calls } = setup([fail("not_configured"), ok]);
    expect(await outbox.submit(clip())).toMatchObject({ ok: true, delivered: false, queued: true, code: "not_configured" });
    expect(await outbox.size()).toBe(1);
    advance(60_000);
    expect(await outbox.flush()).toEqual({ delivered: 1, dropped: 0, pending: 0 });
    expect(calls).toHaveLength(2);
  });

  it("keeps these entries far longer than ordinary network failures", async () => {
    const { outbox, advance } = setup(Array.from({ length: 80 }, () => fail("not_configured")));
    await outbox.submit(clip());
    let rounds = 0;
    for (; (await outbox.size()) > 0 && rounds < 100; rounds++) {
      advance(31 * 60_000);
      await outbox.flush();
    }
    expect(rounds).toBeGreaterThan(30); // network errors are dropped after 8 attempts
    expect(await outbox.size()).toBe(0);

    const net = setup(Array.from({ length: 20 }, () => fail("network")));
    await net.outbox.submit(clip());
    let netRounds = 0;
    for (; (await net.outbox.size()) > 0 && netRounds < 100; netRounds++) {
      net.advance(31 * 60_000);
      await net.outbox.flush();
    }
    expect(netRounds).toBeLessThan(10);
  });

  it("never retries final failures", async () => {
    for (const code of ["unauthorized", "invalid_request"] as const) {
      const { outbox } = setup([fail(code)]);
      expect(await outbox.submit(clip())).toMatchObject({ ok: false, error: { code } });
      expect(await outbox.size()).toBe(0);
    }
  });
});

describe("force flush", () => {
  it("delivers entries that are not due yet (settings were just saved)", async () => {
    const { outbox, calls } = setup([fail("network"), ok]);
    await outbox.submit(clip());
    expect(await outbox.flush()).toEqual({ delivered: 0, dropped: 0, pending: 1 });
    expect(await outbox.flush({ force: true })).toEqual({ delivered: 1, dropped: 0, pending: 0 });
    expect(calls).toHaveLength(2);
  });
});

describe("idempotency key", () => {
  it("is generated per capture, unique across captures", () => {
    const a = clip();
    const b = clip();
    expect(a.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.idempotency_key).not.toBe(b.idempotency_key);
    expect(buildAiChat({ platform: "claude", scope: "answer", url: "https://claude.ai/c/1", title: "t", content_md: "x", message_count: 1 }).idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(buildHighlight(page, "q", { v: 1, quote: { exact: "q", prefix: "", suffix: "" }, position: { start: 0, end: 1 }, range: { startXPath: "/a", startOffset: 0, endXPath: "/a", endOffset: 1 } }).idempotency_key).toBeTruthy();
  });

  it("is reused by every retry of the same queued capture", async () => {
    const { outbox, advance, calls } = setup([fail("network"), fail("server_error"), ok]);
    const req = clip();
    await outbox.submit(req);
    advance(60_000);
    await outbox.flush();
    advance(10 * 60_000);
    await outbox.flush();
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.idempotency_key)).size).toBe(1);
    expect(calls[0]!.idempotency_key).toBe(req.idempotency_key);
  });

  it("sends the trimmed request and reports what was shortened", async () => {
    const { outbox, calls } = setup([ok]);
    const res = await outbox.submit(clip({ note: "n".repeat(30_000) }));
    expect(res).toMatchObject({ ok: true, delivered: true, notices: ["Notiz auf 20.000 Zeichen gekürzt"] });
    expect((calls[0] as { note: string }).note).toHaveLength(20_000);
  });

  it("queues the trimmed request too and keeps the notices for the UI", async () => {
    const { outbox, store } = setup([fail("network")]);
    const res = await outbox.submit({ ...clip(), image_url: "data:image/png;base64,AAAA", title: "T".repeat(600) });
    expect(res).toMatchObject({ ok: true, queued: true, notices: ["Titel auf 500 Zeichen gekürzt"] });
    const [entry] = (await store.get<{ request: { title: string; image_url: string | null }; lastCode: string }[]>("outbox"))!;
    expect(entry!.request.title).toHaveLength(500);
    expect(entry!.request.image_url).toBeNull();
    expect(entry!.lastCode).toBe("network");
  });

  it("refuses requests that cannot be made to fit", async () => {
    const { outbox, calls } = setup([]);
    const res = await outbox.submit({ ...clip(), url: `https://a.dev/${"x".repeat(5000)}` });
    expect(res).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(calls).toHaveLength(0);
  });
});
