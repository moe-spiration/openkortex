import { describe, expect, it, vi } from "vitest";
import {
  createBriefingCache,
  createDbBriefingCache,
  fallbackSummary,
  getBriefing,
  parseBriefingAnswer,
  rankTasks,
  shownTasks,
  templateSummary,
  type BriefingTaskRow,
} from "../home/briefing";
import {
  loadHomeData,
  plainExcerpt,
  rediscoverTerms,
  relativeDay,
  toBackIn,
  type HomeClock,
} from "../home/service";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, OTHER_USER, USER_ID } from "./helpers";

const clock: HomeClock = {
  today: "2026-10-23",
  timeZone: "Europe/Berlin",
  now: new Date("2026-10-23T08:00:00Z"),
};

const item = (over: Record<string, unknown>) => ({
  user_id: USER_ID,
  type: "note",
  title: "Notiz",
  summary: null,
  content_md: "",
  tags: [],
  cluster_name: null,
  cover_image_url: null,
  reading_state: null,
  file_storage_path: null,
  file_mime_type: null,
  flashcards: null,
  metadata: {},
  status: "processed",
  created_at: "2026-10-20T10:00:00Z",
  updated_at: "2026-10-20T10:00:00Z",
  ...over,
});

const task = (
  over: Partial<BriefingTaskRow> & { id: string },
): BriefingTaskRow & Record<string, unknown> => ({
  user_id: USER_ID,
  title: over.id,
  status: "open",
  priority: "medium",
  due_date: null,
  source_item_id: null,
  source_timestamp_sec: null,
  created_at: "2026-10-22T10:00:00Z",
  ...over,
});

describe("home helpers", () => {
  it("formats relative days in the user's time zone", () => {
    expect(relativeDay("2026-10-22T23:30:00Z", clock)).toBe("heute"); // 01:30 in Berlin
    expect(relativeDay("2026-10-22T10:00:00Z", clock)).toBe("gestern");
    expect(relativeDay("2026-10-19T10:00:00Z", clock)).toBe("vor 4 Tagen");
    expect(relativeDay("2026-09-12T10:00:00Z", clock)).toBe("12.09.");
  });

  it("strips markdown for excerpts and cuts at a word", () => {
    expect(plainExcerpt("# Titel\n\n- [x] **Fett** und [[Link|Alias]] [web](https://x)", 100)).toBe(
      "Titel Fett und Alias web",
    );
    expect(plainExcerpt("eins zwei drei vier", 12)).toBe("eins zwei…");
  });

  it("builds distinct rediscover terms without stop words", () => {
    expect(rediscoverTerms(["Hybrid Search und RRF", "hybrid search tuning", "2026"])).toEqual([
      "hybrid",
      "search",
      "tuning",
    ]);
  });

  it("shows reading progress for pdf/epub with a reading_state only", () => {
    const pdf = toBackIn(
      item({
        id: "p",
        type: "pdf",
        reading_state: { page: 42, progress: 0.13 },
        file_storage_path: "u/a.pdf",
        file_mime_type: "application/pdf",
      }) as never,
      clock,
    );
    expect(pdf).toMatchObject({ meta: "Weiterlesen ab S. 42", pct: 13, reader: true });
    const note = toBackIn(item({ id: "n", updated_at: "2026-10-22T10:00:00Z" }) as never, clock);
    expect(note).toMatchObject({ meta: "Zuletzt bearbeitet · gestern", pct: null, reader: false });
  });

  it("ranks overdue and due tasks first, then priority", () => {
    const ranked = rankTasks(
      [
        task({ id: "later", due_date: "2026-11-01" }),
        task({ id: "urgent", priority: "urgent" }),
        task({ id: "today", due_date: "2026-10-23" }),
      ],
      "2026-10-23",
    );
    expect(ranked.map((t) => t.id)).toEqual(["today", "later", "urgent"]);
    expect(shownTasks(ranked, ["urgent", "gone"]).map((t) => t.id)).toEqual([
      "urgent",
      "today",
      "later",
    ]);
  });
});

describe("loadHomeData", () => {
  it("returns empty sections for a fresh account", async () => {
    const db = new FakeSupabase();
    const data = await loadHomeData({ client: db.client, userId: USER_ID }, clock);
    expect(data).toEqual({
      backIn: [],
      archive: null,
      flashcards: null,
      fitsToday: null,
      meeting: null,
      mixes: [],
    });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("fills every section from the user's own items", async () => {
    const db = new FakeSupabase({
      knowledge_items: [
        item({
          id: "recent",
          title: "Hybrid Search Tuning",
          tags: ["ai/search"],
          updated_at: "2026-10-22T18:00:00Z",
        }),
        item({
          id: "old",
          title: "RRF Grundlagen",
          summary: "Reciprocal Rank Fusion für Hybrid Search.",
          tags: ["ai/search"],
          created_at: "2025-10-23T09:00:00Z",
          updated_at: "2025-11-01T09:00:00Z",
        }),
        item({
          id: "older",
          title: "RRF Benchmark",
          summary: "Hybrid Search schlägt reine Vektorsuche.",
          created_at: "2026-01-10T09:00:00Z",
          updated_at: "2026-01-10T09:00:00Z",
        }),
        item({
          id: "cards",
          title: "AI Engineering",
          flashcards: [{ question: "Was ist RRF?", answer: "Rangfusion." }],
          updated_at: "2026-10-01T09:00:00Z",
        }),
        item({
          id: "meet",
          type: "meeting",
          title: "Sync",
          metadata: {
            participants: ["Max", "Sven"],
            decisions: ["MCP zuerst"],
            duration_sec: 1800,
          },
          created_at: "2026-10-23T07:00:00Z",
          updated_at: "2026-10-23T07:30:00Z",
        }),
        item({
          id: "daily",
          type: "daily_note",
          slug: "2026-10-23",
          title: "Daily",
          updated_at: "2026-10-23T07:45:00Z",
        }),
        item({
          id: "foreign",
          user_id: OTHER_USER,
          title: "Fremd",
          tags: ["ai/search"],
          updated_at: "2026-10-23T07:50:00Z",
        }),
      ],
    });
    db.rpcHandlers.match_knowledge_hybrid = () => [
      {
        item_id: "recent",
        title: "Hybrid Search Tuning",
        type: "note",
        chunk_text: "",
        summary: "",
      },
      {
        item_id: "old",
        title: "RRF Grundlagen",
        type: "note",
        chunk_text: "RRF kombiniert Ranglisten.",
        summary: "",
      },
      { item_id: "older", title: "RRF Benchmark", type: "note", chunk_text: "", summary: "" },
    ];
    const embedQuery = vi.fn(async () => ({ embedding: [0.1], modelKey: "openrouter:x" }));
    const data = await loadHomeData({ client: db.client, userId: USER_ID }, clock, embedQuery);

    expect(data.backIn.map((b) => b.id)).toEqual(["meet", "recent", "cards", "older", "old"]);
    expect(data.archive).toMatchObject({
      id: "old",
      yearAgo: true,
      quote: "Reciprocal Rank Fusion für Hybrid Search.",
    });
    expect(data.flashcards).toEqual({
      itemId: "cards",
      deck: "AI Engineering",
      cards: [["Was ist RRF?", "Rangfusion."]],
    });
    // The archive card already shows "old": "Passt zu heute" takes the next match.
    expect(data.fitsToday).toMatchObject({ id: "older", seed: "Hybrid Search Tuning" });
    expect(embedQuery).toHaveBeenCalledOnce();
    expect(db.rpcCalls[0]?.args).toMatchObject({ filter_embedding_model: "openrouter:x" });
    expect(data.meeting).toMatchObject({
      id: "meet",
      people: ["Max", "Sven"],
      coaching: "MCP zuerst",
      durationSec: 1800,
    });
    expect(data.mixes).toEqual([{ tag: "ai/search", count: 2, cluster: null, img: null }]);
  });
});

describe("getBriefing", () => {
  const ctxOf = (db: FakeSupabase) => ({ client: db.client, userId: USER_ID });

  it("uses the template without a model call when there is nothing to brief", async () => {
    const models = vi.fn(async () => mockRouter());
    const b = await getBriefing(ctxOf(new FakeSupabase()), clock, {
      cache: createBriefingCache(),
      models,
    });
    expect(b).toMatchObject({
      kind: "template",
      summary: templateSummary(),
      tasks: [],
      noteId: null,
    });
    expect(models).not.toHaveBeenCalled();
  });

  it("generates once per day, keeps the model's task order and reloads tasks fresh", async () => {
    const db = new FakeSupabase({
      action_items: [
        task({ id: "t1", title: "Spec ergänzen" }),
        task({
          id: "t2",
          title: "Checksum senden",
          source_item_id: "src",
          source_timestamp_sec: 860,
        }),
      ],
    });
    const fast = mockModel([
      { summary: "Zwei offene Punkte, zuerst die **Checksum**.", task_ids: ["t2", "nope"] },
    ]);
    const models = vi.fn(async () => mockRouter({ fast }));
    const cache = createBriefingCache();

    const [a, again] = await Promise.all([
      getBriefing(ctxOf(db), clock, { cache, models }),
      getBriefing(ctxOf(db), clock, { cache, models }),
    ]);
    expect(a).toMatchObject({
      kind: "ai",
      summary: "Zwei offene Punkte, zuerst die Checksum.",
      taskIds: ["t2"],
      noteId: "src",
      noteIsMeeting: false,
    });
    expect(a.tasks.map((t) => [t.id, t.ts])).toEqual([
      ["t2", "14:20"],
      ["t1", null],
    ]);
    expect(again.summary).toBe(a.summary);
    expect(models).toHaveBeenCalledTimes(1);

    db.rows("action_items").find((t) => t.id === "t2")!.status = "done";
    const later = await getBriefing(ctxOf(db), clock, { cache, models });
    expect(later.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(models).toHaveBeenCalledTimes(1);
  });

  it("stores the day's briefing in kortex.user_insights, so a new process (fresh cache) reuses it", async () => {
    const db = new FakeSupabase({
      action_items: [task({ id: "t1", title: "Spec ergänzen" })],
      user_insights: [{ user_id: USER_ID, kind: "briefing", key: "2026-10-01", payload: {} }],
    });
    const models = vi.fn(async () =>
      mockRouter({ fast: mockModel([{ summary: "Ein Punkt offen.", task_ids: ["t1"] }]) }),
    );
    const first = await getBriefing(ctxOf(db), clock, { cache: createDbBriefingCache(), models });
    expect(first.kind).toBe("ai");
    const rows = db.rows("user_insights");
    expect(rows.map((r) => [r.kind, r.key])).toEqual([["briefing", "2026-10-23"]]); // older than 14 days pruned
    expect(rows[0]!.payload).toMatchObject({ summary: "Ein Punkt offen.", kind: "ai" });

    const restarted = await getBriefing(ctxOf(db), clock, {
      cache: createDbBriefingCache(),
      models,
    });
    expect(restarted.summary).toBe("Ein Punkt offen.");
    expect(models).toHaveBeenCalledTimes(1);
  });

  it("adopts the client's copy of today's briefing instead of generating again", async () => {
    const db = new FakeSupabase({ action_items: [task({ id: "t1" })] });
    const models = vi.fn(async () => mockRouter());
    const cached = {
      date: "2026-10-23",
      summary: "Schon geschrieben.",
      taskIds: ["t1"],
      kind: "ai",
      model: "x:y",
      generatedAt: "2026-10-23T06:00:00Z",
    };
    const b = await getBriefing(ctxOf(db), clock, {
      cache: createBriefingCache(),
      models,
      clientCopy: cached,
    });
    expect(b.summary).toBe("Schon geschrieben.");
    expect(models).not.toHaveBeenCalled();
    // A copy from another day is ignored.
    const other = await getBriefing(ctxOf(db), clock, {
      cache: createBriefingCache(),
      models: async () => mockRouter({ fast: mockModel([{ summary: "Neu.", task_ids: [] }]) }),
      clientCopy: { ...cached, date: "2026-10-22" },
    });
    expect(other.summary).toBe("Neu.");
  });

  it("reads fenced JSON and plain prose answers", () => {
    expect(parseBriefingAnswer('```json\n{"summary": "Kurz.", "task_ids": ["t1"]}\n```')).toEqual({
      summary: "Kurz.",
      task_ids: ["t1"],
    });
    expect(parseBriefingAnswer("Heute zählt nur der Sync.")).toEqual({
      summary: "Heute zählt nur der Sync.",
      task_ids: [],
    });
    expect(parseBriefingAnswer('{"broken": ')).toEqual({ summary: "", task_ids: [] });
  });

  it("falls back to a plain sentence when the model fails", async () => {
    const db = new FakeSupabase({ action_items: [task({ id: "t1" }), task({ id: "t2" })] });
    const log = vi.fn();
    const b = await getBriefing(ctxOf(db), clock, {
      cache: createBriefingCache(),
      models: async () => {
        throw new Error("Kein KI-Provider konfiguriert");
      },
      log,
    });
    expect(b).toMatchObject({ kind: "fallback", summary: "2 offene Aufgaben." });
    expect(log).toHaveBeenCalled();
    expect(fallbackSummary({ daily: null, tasks: [], recent: [], meeting: null })).toBe(
      templateSummary(),
    );
  });
});
