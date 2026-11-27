import { describe, expect, it } from "vitest";
import { createQueue, isNetworkError, MAX_TRIES, type QueueJob } from "../src/capture/queue";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) };
};
const note = (title: string): QueueJob => ({ kind: "ingest", title, req: { kind: "note", content_md: title, client: { name: "kortex-mobile", version: "0" }, captured_at: "" } });

describe("capture queue", () => {
  it("put stores a job before sending and remove takes exactly that one out (quick overlay)", async () => {
    const q = createQueue(memory());
    await q.add(note("old"));
    const id = await q.put(note("voice"));
    expect((await q.list()).map((j) => j.title)).toEqual(["old", "voice"]);
    await q.remove(id);
    await q.remove("missing");
    expect((await q.list()).map((j) => j.title)).toEqual(["old"]);
  });

  it("sends oldest first and keeps the rest when still offline", async () => {
    const q = createQueue(memory());
    await q.add(note("a"));
    await q.add(note("b"));
    await q.add(note("c"));
    const seen: string[] = [];
    const r = await q.flush(async (j) => {
      seen.push(j.title);
      return j.title === "b" ? "retry" : "ok";
    });
    expect(seen).toEqual(["a", "b"]);
    expect(r).toEqual({ sent: 1, dropped: 0, left: 2 });
    const left = await q.list();
    expect(left.map((j) => [j.title, j.tries])).toEqual([["b", 1], ["c", 0]]);
  });

  it("drops permanent failures and gives up after MAX_TRIES", async () => {
    const q = createQueue(memory());
    await q.add(note("bad"));
    expect(await q.flush(async () => "drop")).toEqual({ sent: 0, dropped: 1, left: 0 });
    await q.add(note("flaky"));
    for (let i = 0; i < MAX_TRIES - 1; i++) await q.flush(async () => "retry");
    expect((await q.list())[0]!.tries).toBe(MAX_TRIES - 1);
    expect((await q.flush(async () => "retry")).left).toBe(0);
  });

  it("treats a thrown send as offline and survives broken storage", async () => {
    const q = createQueue(memory());
    await q.add(note("x"));
    expect((await q.flush(async () => Promise.reject(new TypeError("Network request failed")))).left).toBe(1);
    const broken = createQueue({ getItem: async () => "{not json", setItem: async () => undefined });
    expect(await broken.list()).toEqual([]);
  });

  it("recognises network errors", () => {
    expect(isNetworkError(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkError(new Error("Kortex ist nicht erreichbar"))).toBe(true);
    expect(isNetworkError(new Error("Ungültiges API-Token"))).toBe(false);
  });
});

describe("queue.clear (sign-out)", () => {
  it("drops every waiting capture", async () => {
    const q = createQueue(memory());
    await q.add({ kind: "ingest", title: "x", req: { text: "x" } as never });
    await q.clear();
    expect(await q.list()).toEqual([]);
  });
});
