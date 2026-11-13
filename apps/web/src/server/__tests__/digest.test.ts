import { describe, expect, it } from "vitest";
import { createDigestHandlers } from "../digest/handler";
import { isoWeek } from "../digest/service";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, seedFolders, setup, USER_ID } from "./helpers";

const URL_ = "https://kortex.test/api/digest";

const out = (headline: string) => ({
  headline,
  decisions: ["MCP wird die Agenten-Schnittstelle."],
  progress: ["Hybrid-Search live."],
  blockers_risks: [],
  next_week: ["Deepgram-Keys einrichten."],
});

function seed() {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: "m1",
        user_id: USER_ID,
        title: "Q4 Architektur-Sync",
        type: "meeting",
        summary: "MCP beschlossen.",
        content_md: "…",
        cluster_name: "Kortex",
        folder_path: "20_Meetings",
        updated_at: "2026-10-21T10:00:00Z",
      },
      {
        id: "n1",
        user_id: USER_ID,
        title: "Hybrid-Search Notiz",
        type: "note",
        summary: null,
        content_md: "RRF funktioniert.",
        cluster_name: "Kortex",
        folder_path: "10_Notes",
        updated_at: "2026-10-22T10:00:00Z",
      },
      {
        id: "n2",
        user_id: USER_ID,
        title: "HYROX Plan",
        type: "note",
        summary: "Training",
        content_md: "…",
        cluster_name: "General",
        folder_path: "10_Notes/Fitness",
        updated_at: "2026-10-20T10:00:00Z",
      },
      {
        id: "old",
        user_id: USER_ID,
        title: "Alte Notiz",
        type: "note",
        summary: null,
        content_md: "…",
        cluster_name: "Kortex",
        folder_path: "10_Notes",
        updated_at: "2026-09-01T10:00:00Z",
      },
      {
        id: "p1",
        user_id: USER_ID,
        title: "Sven",
        type: "person",
        summary: null,
        content_md: "",
        cluster_name: "Kortex",
        folder_path: "70_Objects/People",
        updated_at: "2026-10-22T10:00:00Z",
      },
      {
        id: "x1",
        user_id: "99999999-9999-4999-8999-999999999999",
        title: "Fremd",
        type: "note",
        summary: null,
        content_md: "",
        cluster_name: "Kortex",
        folder_path: "10_Notes",
        updated_at: "2026-10-22T10:00:00Z",
      },
    ],
    action_items: [
      {
        id: "t1",
        user_id: USER_ID,
        title: "Deepgram-Keys einrichten",
        status: "open",
        priority: "medium",
        due_date: "2026-10-25",
        assignee: "Sven",
        completed_at: null,
        source_item_id: "m1",
        created_at: "2026-10-21T10:30:00Z",
      },
      {
        id: "t2",
        user_id: USER_ID,
        title: "Schema finalisieren",
        status: "done",
        priority: "high",
        due_date: null,
        assignee: "Me",
        completed_at: "2026-10-22T09:00:00Z",
        source_item_id: "old",
        created_at: "2026-09-01T10:00:00Z",
      },
    ],
  });
  seedFolders(db);
  db.authUser = { id: USER_ID };
  return db;
}

const session = (body?: unknown) =>
  new Request(URL_, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { cookie: "sb=x" },
  });

describe("POST /api/digest", () => {
  it("writes one digest per cluster/folder for the last 7 days into 90_Digests", async () => {
    const db = seed();
    const chat = mockModel([out("Kortex: MCP beschlossen, Search live."), out("Fitness läuft.")]);
    const s = setup({ db, models: mockRouter({ chat }) });
    const res = await createDigestHandlers(() => s.deps).POST(session());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.period).toEqual({
      start: "2026-10-16T08:00:00.000Z",
      end: "2026-10-23T08:00:00.000Z",
      iso_week: "2026-W43",
    });
    expect(
      body.digests.map((d: { group: string; source_count: number; task_count: number }) => [
        d.group,
        d.source_count,
        d.task_count,
      ]),
    ).toEqual([
      ["Kortex", 2, 2],
      ["10_Notes", 1, 0],
    ]);

    const md = body.digests[0].content_md as string;
    expect(md).toMatch(
      /^# Weekly Digest · Kortex · KW 43\/2026\n\n> Zeitraum 16\.10\.2026 – 23\.10\.2026 · 2 Einträge · 2 Aufgaben/,
    );
    expect(md).toContain(
      "## 1. Entscheidungen (Decisions)\n\n- MCP wird die Agenten-Schnittstelle.",
    );
    expect(md).toContain("## 3. Blocker & Risiken (Blockers & Risks)\n\n- Keine");
    expect(md).toContain(
      "## 4. Prioritäten nächste Woche (Next Week)\n\n- Deepgram-Keys einrichten.",
    );
    expect(md).toContain("- [[Q4 Architektur-Sync]] · meeting · 21.10.2026");

    // The model saw this week's items and tasks only (no old note, no objects, no other user).
    const prompt = JSON.stringify(chat.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Q4 Architektur-Sync");
    expect(prompt).toContain("[done] Schema finalisieren");
    expect(prompt).not.toContain("Alte Notiz");
    expect(prompt).not.toContain("Fremd");
    expect(prompt).not.toContain("Sven (person)");

    const digests = db.rows("knowledge_items").filter((i) => i.type === "digest");
    expect(digests).toHaveLength(2);
    expect(digests[0]).toMatchObject({
      user_id: USER_ID,
      title: "Weekly Digest KW 43/2026 · Kortex",
      slug: "weekly-digest-2026-w43-kortex",
      folder_path: "90_Digests",
      folder_id: "f-90_Digests",
      cluster_name: "Kortex",
      is_manual_placement: true,
      status: "processed",
      tags: ["digest/weekly"],
      related_item_ids: ["n1", "m1"],
      summary: "Kortex: MCP beschlossen, Search live.",
    });
    expect(digests[1]?.cluster_name).toBeUndefined();
    expect(
      db.rows("item_chunks").filter((c) => c.item_id === digests[0]?.id).length,
    ).toBeGreaterThan(0);
  });

  it("updates the same week's digest instead of duplicating it", async () => {
    const db = seed();
    const s = setup({ db, models: mockRouter({ chat: mockModel([out("v1")]) }) });
    const h = createDigestHandlers(() => s.deps);
    const first = await (await h.POST(session({ cluster: "Kortex" }))).json();
    const second = await (await h.POST(session({ cluster: "Kortex" }))).json();
    expect(first.digests).toHaveLength(1);
    expect(second.digests[0]).toMatchObject({ item_id: first.digests[0].item_id, updated: true });
    expect(db.rows("knowledge_items").filter((i) => i.type === "digest")).toHaveLength(1);
  });

  it("scopes to a folder, previews without saving, and returns nothing for a quiet week", async () => {
    const db = seed();
    const s = setup({ db, models: mockRouter({ chat: mockModel([out("Fitness")]) }) });
    const h = createDigestHandlers(() => s.deps);
    const preview = await (
      await h.POST(session({ folder_path: "10_Notes/Fitness", save: false }))
    ).json();
    expect(preview.digests).toEqual([
      expect.objectContaining({ group: "10_Notes/Fitness", item_id: null, source_count: 1 }),
    ]);
    expect(db.rows("knowledge_items").some((i) => i.type === "digest")).toBe(false);

    const quiet = await (await h.POST(session({ cluster: "Gibt es nicht" }))).json();
    expect(quiet.digests).toEqual([]);
  });

  it("validates the body", async () => {
    const s = setup({ db: seed() });
    const h = createDigestHandlers(() => s.deps);
    expect((await h.POST(session({ days: 90 }))).status).toBe(400);
    expect((await h.POST(session({ model: "foo/bar" }))).status).toBe(400);
    const broken = await h.POST(
      new Request(URL_, { method: "POST", body: "{", headers: { cookie: "sb=x" } }),
    );
    expect((await broken.json()).error.code).toBe("invalid_request");
  });

  it("computes ISO weeks", () => {
    expect(isoWeek(new Date("2026-10-23T08:00:00Z"))).toEqual({ year: 2026, week: 43 });
    expect(isoWeek(new Date("2027-01-01T08:00:00Z"))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(new Date("2025-12-29T08:00:00Z"))).toEqual({ year: 2026, week: 1 });
  });
});
