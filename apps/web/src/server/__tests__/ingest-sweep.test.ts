import { describe, expect, it } from "vitest";
import { sweepOrphanItems } from "../ingest/sweep";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, NOW, seedFolders, setup, USER_ID } from "./helpers";

const enrichment = {
  title: "Ziel: 24 Bücher",
  summary: "Leseziel für 2027.",
  cluster_name: "Personal",
  suggested_folder_path: "10_Notes",
  tags: ["ziele/lesen"],
  entities: [],
  action_items: [{ title: "Leseliste anlegen", description: null, assignee: "Me", priority: "low", due_date: null, source_timestamp_sec: null }],
};

const old = new Date(NOW.getTime() - 10 * 60_000).toISOString();

function make() {
  const db = new FakeSupabase();
  seedFolders(db);
  db.rows("folders").push({ id: "f-goals", user_id: USER_ID, folder_path: "70_Objects/Goals", name: "Goals", slug: "goals", parent_id: null });
  const s = setup({ db, models: mockRouter({ fast: mockModel([enrichment, enrichment]) }) });
  return s;
}

const goal = (over: Record<string, unknown> = {}) => ({
  id: "33333333-3333-4333-8333-000000000001",
  user_id: USER_ID,
  type: "goal",
  title: "24 Bücher in 2027",
  slug: "24-buecher-in-2027",
  content_md: "# 24 Bücher in 2027\n\nZwei Bücher pro Monat lesen.",
  source_platform: "mcp",
  folder_path: "70_Objects/Goals",
  folder_id: "f-goals",
  is_manual_placement: true,
  tags: ["life-os"],
  metadata: { status: "active", target_metric: "24 Bücher" },
  status: "inbox",
  created_at: old,
  updated_at: old,
  ...over,
});

describe("ingest sweep (agent saves without a job)", () => {
  it("enriches an MCP save and keeps its Markdown, title, type, folder and own metadata", async () => {
    const s = make();
    s.db.rows("knowledge_items").push(goal());
    expect(await sweepOrphanItems(s.deps, s.deps.queue)).toBe(1);
    await s.drain();
    const it = s.db.rows("knowledge_items")[0]!;
    expect(it.status).toBe("processed");
    expect(it.title).toBe("24 Bücher in 2027");
    expect(it.type).toBe("goal");
    expect(it.content_md).toBe("# 24 Bücher in 2027\n\nZwei Bücher pro Monat lesen.");
    expect(it.folder_path).toBe("70_Objects/Goals");
    expect(it.summary).toBe("Leseziel für 2027.");
    expect(it.tags).toEqual(expect.arrayContaining(["life-os"]));
    const meta = it.metadata as Record<string, unknown>;
    expect(meta.status).toBe("active");
    expect(meta.target_metric).toBe("24 Bücher");
    expect((meta.ingest as { state: string }).state).toBe("done");
    expect(s.db.rows("item_chunks").length).toBeGreaterThan(0);
    expect(s.db.rows("action_items")).toHaveLength(0);
    // Done: the next sweep finds nothing.
    expect(await sweepOrphanItems(s.deps, s.deps.queue)).toBe(0);
  });

  it("leaves fresh saves, other sources, queued items and over-budget users alone", async () => {
    const s = make();
    s.db.rows("knowledge_items").push(
      goal({ id: "a", created_at: NOW.toISOString() }),
      goal({ id: "b", source_platform: "web" }),
      goal({ id: "c", metadata: { ingest: { state: "queued" } } }),
      goal({ id: "d", status: "processed" }),
    );
    expect(await sweepOrphanItems(s.deps, s.deps.queue)).toBe(0);

    s.db.rows("knowledge_items").push(goal({ id: "e" }));
    s.db.rows("user_settings").push({ user_id: USER_ID, daily_ai_budget_eur: 1 });
    s.db.rows("ai_usage").push({ user_id: USER_ID, day: NOW.toISOString().slice(0, 10), cost_usd: 50, created_at: NOW.toISOString() });
    expect(await sweepOrphanItems(s.deps, s.deps.queue)).toBe(0);
  });
});
