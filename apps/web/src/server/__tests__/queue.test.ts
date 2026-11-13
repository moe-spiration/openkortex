import { describe, expect, it } from "vitest";
import { createJobQueue } from "../queue";

describe("createJobQueue", () => {
  it("runs at most `concurrency` jobs at once and reports failures without rejecting", async () => {
    const errors: string[] = [];
    const q = createJobQueue({ concurrency: 2, onError: (label) => errors.push(label) });
    let running = 0;
    let peak = 0;
    const job =
      (fail = false) =>
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        if (fail) throw new Error("x");
      };
    const done = [
      q.enqueue("a", job()),
      q.enqueue("b", job(true)),
      q.enqueue("c", job()),
      q.enqueue("d", job()),
    ];
    expect(q.size()).toBe(4);
    await Promise.all(done);
    await q.idle();
    expect(peak).toBe(2);
    expect(errors).toEqual(["b"]);
    expect(q.size()).toBe(0);
  });
});
