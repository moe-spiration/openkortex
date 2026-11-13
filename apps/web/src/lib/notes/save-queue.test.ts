import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentSaver, type SaveResult } from "./save-queue";

/** A save whose completion the test controls. */
function deferredSaves() {
  const calls: { id: string; md: string; resolve: (r: SaveResult) => void }[] = [];
  const save = (id: string, md: string) => new Promise<SaveResult>((resolve) => calls.push({ id, md, resolve }));
  return { calls, save };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createContentSaver", () => {
  it("debounces and sends only the newest text", async () => {
    const { calls, save } = deferredSaves();
    const s = createContentSaver({ save, delayMs: 800 });
    s.schedule("n1", "a");
    await vi.advanceTimersByTimeAsync(500);
    s.schedule("n1", "ab");
    s.schedule("n1", "abc");
    await vi.advanceTimersByTimeAsync(799);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.md)).toEqual(["abc"]);
  });

  it("never sends two saves of one note at once; the last version wins", async () => {
    const { calls, save } = deferredSaves();
    const saved: string[] = [];
    const s = createContentSaver({ save, delayMs: 10, onSaved: (_id, md) => saved.push(md) });
    s.schedule("n1", "v1");
    await vi.advanceTimersByTimeAsync(10);
    expect(calls.map((c) => c.md)).toEqual(["v1"]);
    // Two more edits while v1 is in flight: only v3 follows, after v1 has finished.
    s.schedule("n1", "v2");
    await vi.advanceTimersByTimeAsync(10);
    s.schedule("n1", "v3");
    await vi.advanceTimersByTimeAsync(10);
    expect(calls.map((c) => c.md)).toEqual(["v1"]);
    calls[0]!.resolve({ ok: true });
    await settle();
    expect(calls.map((c) => c.md)).toEqual(["v1", "v3"]);
    expect(saved).toEqual([]); // v1 is superseded, not reported as the saved state
    calls[1]!.resolve({ ok: true });
    await settle();
    expect(saved).toEqual(["v3"]);
    expect(s.dirtyIds().size).toBe(0);
  });

  it("flush sends pending text at once and resolves when it is saved", async () => {
    const { calls, save } = deferredSaves();
    const s = createContentSaver({ save, delayMs: 800 });
    s.schedule("n1", "x");
    s.schedule("n2", "y");
    expect([...s.dirtyIds()].sort()).toEqual(["n1", "n2"]);
    let done = false;
    const f = s.flush().then(() => (done = true));
    await settle();
    expect(calls.map((c) => `${c.id}:${c.md}`).sort()).toEqual(["n1:x", "n2:y"]);
    expect(done).toBe(false);
    calls.forEach((c) => c.resolve({ ok: true }));
    await f;
    expect(done).toBe(true);
    // The debounce timers were cancelled: nothing is sent twice.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
  });

  it("flush waits for a save in flight and then sends the newer text", async () => {
    const { calls, save } = deferredSaves();
    const s = createContentSaver({ save, delayMs: 10 });
    s.schedule("n1", "old");
    await vi.advanceTimersByTimeAsync(10);
    s.schedule("n1", "new");
    const f = s.flush("n1");
    await settle();
    expect(calls.map((c) => c.md)).toEqual(["old"]);
    calls[0]!.resolve({ ok: true });
    await settle();
    expect(calls.map((c) => c.md)).toEqual(["old", "new"]);
    calls[1]!.resolve({ ok: true });
    await f;
    expect(s.dirtyIds().size).toBe(0);
  });

  it("a failed save is reported, stays dirty and is retried by flush", async () => {
    const { calls, save } = deferredSaves();
    const errors: string[] = [];
    const s = createContentSaver({ save, delayMs: 10, onError: (id, e) => errors.push(`${id}:${e}`) });
    s.schedule("n1", "text");
    await vi.advanceTimersByTimeAsync(10);
    calls[0]!.resolve({ ok: false, error: "offline" });
    await settle();
    expect(errors).toEqual(["n1:offline"]);
    expect(s.dirtyIds().has("n1")).toBe(true);
    expect(s.pendingText("n1")).toBe("text");
    void s.flush("n1");
    await settle();
    expect(calls.map((c) => c.md)).toEqual(["text", "text"]);
    calls[1]!.resolve({ ok: true });
    await settle();
    expect(s.dirtyIds().size).toBe(0);
  });

  it("a thrown save counts as a failure, and a newer edit replaces the failed text", async () => {
    const errors: string[] = [];
    let n = 0;
    const sent: string[] = [];
    const s = createContentSaver({
      delayMs: 10,
      save: async (_id, md) => {
        sent.push(md);
        if (n++ === 0) throw new Error("network");
        return { ok: true };
      },
      onError: (_id, e) => errors.push(e),
    });
    s.schedule("n1", "first");
    await vi.advanceTimersByTimeAsync(10);
    expect(errors).toEqual(["network"]);
    s.schedule("n1", "second");
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual(["first", "second"]);
    expect(s.dirtyIds().size).toBe(0);
  });
});
