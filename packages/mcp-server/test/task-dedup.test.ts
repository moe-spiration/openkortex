import type { KortexClient } from "@kortex/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SupabaseBrainRepository } from "../src/supabase-repository";
import { connect } from "./helpers";

// brain_manage_tasks create: an open task with the same title (matchKey) is returned, not created
// twice (@kortex/db findOpenTaskByTitle). Done tasks never block a new one.

describe("brain_manage_tasks create dedup (tool, in-memory repository)", () => {
  let t: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    t = await connect();
  });
  afterEach(() => t.close());

  const create = async (title: string) =>
    (await t.call("brain_manage_tasks", { action: "create", title })).json;

  it("returns the open task with the same title and flags it", async () => {
    const a = await create("Steuer abgeben");
    expect(a.duplicate).toBeUndefined();
    const b = await create("  steuer-abgeben! ");
    expect(b.task.id).toBe(a.task.id);
    expect(b.duplicate).toBe(true);
    expect(t.repo.tasks.size).toBe(1);

    await t.call("brain_manage_tasks", { action: "complete", task_id: a.task.id });
    const c = await create("Steuer abgeben");
    expect(c.task.id).not.toBe(a.task.id);
    expect(t.repo.tasks.size).toBe(2);
  });
});

// Minimal supabase-js stand-in for action_items (select/insert + eq/in/order/limit/single).
type Row = Record<string, unknown>;
function fakeClient(rows: Row[]) {
  let seq = 0;
  const from = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let insert: Row | null = null;
    const q = {
      select: () => q,
      insert: (r: Row) => {
        insert = r;
        return q;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      order: () => q,
      limit: () => q,
      single: () => q,
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        if (insert) {
          const row = {
            id: `new-${++seq}`,
            status: "open",
            created_at: "2026-11-01T00:00:00Z",
            ...insert,
          };
          rows.push(row);
          return Promise.resolve(resolve({ data: row, error: null }));
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        return Promise.resolve(resolve({ data: single ? (hit[0] ?? null) : hit, error: null }));
      },
    };
    let single = false;
    q.single = () => ((single = true), q);
    return q;
  };
  return { from } as unknown as KortexClient;
}

describe("SupabaseBrainRepository.createTask dedup", () => {
  const base = {
    priority: "medium",
    due_date: null,
    source_item_id: null,
    project_item_id: null,
    timeframe: null,
    context: null,
    exported_at: null,
    external_ref: null,
    completed_at: null,
    created_at: "2026-10-01T00:00:00Z",
  };

  it("returns the user's open task with the same title instead of inserting", async () => {
    const rows: Row[] = [
      { ...base, id: "done", user_id: "u1", title: "Server testen", status: "done" },
      { ...base, id: "other-user", user_id: "u2", title: "Server testen", status: "open" },
      { ...base, id: "open", user_id: "u1", title: "Server testen", status: "in_progress" },
    ];
    const repo = new SupabaseBrainRepository({ client: fakeClient(rows), userId: "u1", userScoped: false });
    const res = await repo.createTask({ title: "server  testen", priority: "high", due_date: null });
    expect(res).toMatchObject({ duplicate: true, task: { id: "open" } });
    expect(rows).toHaveLength(3);

    const fresh = await repo.createTask({ title: "Doku schreiben", priority: "low", due_date: null });
    expect(fresh.duplicate).toBe(false);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatchObject({ user_id: "u1", title: "Doku schreiben" });
  });
});
