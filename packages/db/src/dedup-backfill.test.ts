import { describe, expect, it } from "vitest";
import { planSourceUrlNormBackfill } from "./dedup-backfill";

const norm = (u: string) => u.toLowerCase().replace(/\/$/, "");

describe("planSourceUrlNormBackfill", () => {
  it("gives the oldest row the value and leaves duplicates NULL", () => {
    const plan = planSourceUrlNormBackfill(
      [
        { id: "b", user_id: "u1", source_url: "https://X.de/", created_at: "2026-02-01" },
        { id: "a", user_id: "u1", source_url: "https://x.de", created_at: "2026-01-01" },
        { id: "c", user_id: "u2", source_url: "https://x.de", created_at: "2026-03-01" },
        { id: "d", user_id: "u1", source_url: null, created_at: "2026-01-01" },
      ],
      norm,
    );
    expect(plan.assign.map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect(plan.duplicates).toEqual([{ id: "b", keptId: "a", source_url_norm: "https://x.de" }]);
  });
});
