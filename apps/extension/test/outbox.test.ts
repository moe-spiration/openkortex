import { describe, expect, it } from "vitest";
import type { ApiClient, IngestRequest, IngestResponse } from "../src/lib/api";
import { createOutbox } from "../src/lib/outbox";
import { memoryStore } from "../src/lib/settings";
import { buildWebClip } from "../src/lib/requests";

const req = (): IngestRequest =>
  buildWebClip(
    { url: "https://a.dev/x", title: "T", description: null, image_url: null, site_name: null, domain: "a.dev", reading_minutes: null, keywords: [] },
    { folder: null, tags: [], note: "" },
  );
const ok: IngestResponse = { ok: true, kind: "web_clip", item_id: "1", type: "article", status: "inbox", folder_path: "00_Inbox", auto_routed: true, duplicate: false };
const failure = (code: "network" | "server_error" | "unauthorized"): IngestResponse => ({ ok: false, error: { code, message: code } });

function setup(responses: IngestResponse[]) {
  const store = memoryStore();
  const calls: IngestRequest[] = [];
  const api: Pick<ApiClient, "ingest"> = { ingest: async (r) => (calls.push(r), responses.shift() ?? ok) };
  let t = 1_000_000;
  let n = 0;
  const outbox = createOutbox({ store, api, now: () => t, newId: () => `id${++n}` });
  return { outbox, calls, advance: (ms: number) => (t += ms) };
}

describe("outbox", () => {
  it("delivers immediately when the API accepts", async () => {
    const { outbox } = setup([ok]);
    expect(await outbox.submit(req())).toMatchObject({ ok: true, delivered: true });
    expect(await outbox.size()).toBe(0);
  });

  it("rejects invalid requests without calling the API", async () => {
    const { outbox, calls } = setup([]);
    expect(await outbox.submit({ ...req(), url: "nope" } as IngestRequest)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(calls).toHaveLength(0);
  });

  it("reports final failures (auth) instead of queueing them", async () => {
    const { outbox } = setup([failure("unauthorized")]);
    expect(await outbox.submit(req())).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await outbox.size()).toBe(0);
  });

  it("queues transient failures optimistically and delivers them on flush after the backoff", async () => {
    const { outbox, advance, calls } = setup([failure("network"), ok]);
    expect(await outbox.submit(req())).toMatchObject({ ok: true, delivered: false, queued: true });
    expect(await outbox.size()).toBe(1);

    expect(await outbox.flush()).toEqual({ delivered: 0, dropped: 0, pending: 1 }); // not due yet
    expect(calls).toHaveLength(1);

    advance(60_000);
    expect(await outbox.flush()).toEqual({ delivered: 1, dropped: 0, pending: 0 });
    expect(calls).toHaveLength(2);
  });

  it("backs off further after repeated failures and finally drops", async () => {
    const { outbox, advance } = setup(Array.from({ length: 20 }, () => failure("server_error")));
    await outbox.submit(req());
    let dropped = 0;
    for (let i = 0; i < 12 && (await outbox.size()) > 0; i++) {
      advance(60 * 60_000);
      dropped += (await outbox.flush()).dropped;
    }
    expect(dropped).toBe(1);
    expect(await outbox.size()).toBe(0);
  });

  it("drops entries that fail permanently on retry", async () => {
    const { outbox, advance } = setup([failure("network"), failure("unauthorized")]);
    await outbox.submit(req());
    advance(60_000);
    expect(await outbox.flush()).toEqual({ delivered: 0, dropped: 1, pending: 0 });
  });

  it("does not lose entries under concurrent submits", async () => {
    const { outbox } = setup(Array.from({ length: 5 }, () => failure("network")));
    await Promise.all(Array.from({ length: 5 }, () => outbox.submit(req())));
    expect(await outbox.size()).toBe(5);
  });
});
