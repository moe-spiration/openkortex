import { MediaBudgetError } from "@kortex/ai-core";
import { describe, expect, it } from "vitest";
import { WebClipSchema } from "../ingest/contract";
import { createIngestHandlers } from "../ingest/handler";
import { createMediaGuard, DEFAULT_STT_USD_PER_SEC } from "../ingest/media-guard";
import type { IngestJobSpec } from "../ingest/queue";
import { FakeSupabase } from "./fake-supabase";
import { fakeFetch, mockModel, mockRouter, postJson, seedFolders, setup, USER_ID } from "./helpers";

const BASE = "https://kortex.test/api/ingest";
const YT = "https://www.youtube.com/watch?v=abcDEF12345";

const notes = {
  summary: "Ein Talk über Agenten im Second Brain.",
  chapters: [
    { title: "Einstieg", start_sec: 0 },
    { title: "Demo", start_sec: 60 },
  ],
  key_takeaways: ["Agenten brauchen Kontext."],
  learnings: ["Agenten früh Kontext geben."],
  quotes: [{ text: "Kontext ist alles.", speaker: null, time_sec: 65 }],
  resources: ["MCP"],
};
const enrichment = {
  title: "Agenten im Second Brain",
  summary: "Talk über Agenten.",
  cluster_name: "AI",
  suggested_folder_path: "30_Clippings/AI",
  tags: ["ai/agents"],
  entities: [],
  action_items: [],
};

const transcript = {
  text: "Willkommen. Heute geht es um Agenten. Kontext ist alles.",
  lang: "de",
  source: "youtube-captions" as const,
  segments: [
    { start: 0, dur: 4, text: "Willkommen." },
    { start: 30, dur: 4, text: "Heute geht es um Agenten." },
    { start: 65, dur: 3, text: "Kontext ist alles." },
  ],
};

const clip = (over: Record<string, unknown> = {}) => ({
  kind: "web_clip",
  client: { name: "kortex-extension", version: "0.2.0" },
  captured_at: "2026-10-24T08:00:00.000Z",
  url: YT,
  title: "Agenten-Talk – YouTube",
  image_url: "https://i.ytimg.com/vi/abcDEF12345/maxresdefault.jpg",
  ...over,
});

function make(values: unknown[]) {
  const db = new FakeSupabase();
  seedFolders(db);
  const s = setup({ db, models: mockRouter({ fast: mockModel(values) }), fetch: fakeFetch([]) });
  const jobs: IngestJobSpec[] = [];
  const enqueue = s.deps.queue.enqueue.bind(s.deps.queue);
  s.deps.queue = { ...s.deps.queue, enqueue: (ctx, job) => (jobs.push(job), enqueue(ctx, job)) };
  return { ...s, jobs, h: createIngestHandlers(() => s.deps) };
}

describe("web_clip media contract (shared with the extension)", () => {
  it("accepts transcript and media, stays backward compatible", () => {
    expect(WebClipSchema.safeParse(clip()).success).toBe(true);
    const r = WebClipSchema.safeParse(
      clip({
        transcript,
        media: {
          kind: "video",
          provider: "youtube",
          duration_sec: 70,
          channel: "Kortex",
          published_at: "2026-10-01",
        },
      }),
    );
    expect(r.success).toBe(true);
    expect(WebClipSchema.safeParse(clip({ transcript: null, media: null })).success).toBe(true);
  });

  it("refuses an oversized transcript text and unknown sources; trims long caption tracks", () => {
    expect(
      WebClipSchema.safeParse(clip({ transcript: { text: "x".repeat(400_001), source: "page" } }))
        .success,
    ).toBe(false);
    expect(
      WebClipSchema.safeParse(clip({ transcript: { text: "x", source: "whisper" } })).success,
    ).toBe(false);
    const many = Array.from({ length: 20_005 }, (_, i) => ({ start: i, text: "y" }));
    const r = WebClipSchema.parse(
      clip({ transcript: { text: "", source: "page", segments: many } }),
    );
    expect(r.transcript?.segments).toHaveLength(20_000);
  });
});

describe("web_clip with a client transcript", () => {
  it("passes transcript, media, title and cover to the pipeline and writes the structured note", async () => {
    const m = make([notes, enrichment]);
    const media = { kind: "video", provider: "youtube", duration_sec: 70, channel: "Kortex" };
    const body = await (await m.h.POST(postJson(BASE, clip({ transcript, media })))).json();
    expect(body).toMatchObject({ ok: true, type: "video", queued: true });
    expect(m.jobs[0]?.input).toMatchObject({
      url: YT,
      title: "Agenten-Talk – YouTube",
      imageUrl: "https://i.ytimg.com/vi/abcDEF12345/maxresdefault.jpg",
      transcript: { source: "youtube-captions", lang: "de", segments: transcript.segments },
      media,
    });
    await m.drain();
    const item = m.db.rows("knowledge_items")[0] as Record<string, unknown>;
    const md = String(item.content_md);
    expect(item).toMatchObject({ status: "processed", type: "video" });
    expect(md).toContain("## Executive Summary");
    expect(md).toContain(`- [1:00](${YT}&t=60s) Demo`);
    expect(md).toContain("> [!toggle]- Transkript");
    expect((item.metadata as Record<string, unknown>).transcript_source).toBe(
      "client:youtube-captions",
    );
  });

  it("an item saved without transcript is processed again when the extension sends one; notes survive", async () => {
    const m = make([enrichment, notes, enrichment]);
    await m.h.POST(postJson(BASE, clip({ note: "Für das Agenten-Projekt" })));
    await m.drain();
    const first = m.db.rows("knowledge_items")[0] as Record<string, unknown>;
    expect((first.metadata as Record<string, unknown>).transcript_missing).toBe("player_failed");

    const again = await (
      await m.h.POST(postJson(BASE, clip({ transcript, note: "Demo ab 1:00" })))
    ).json();
    expect(again).toMatchObject({ item_id: first.id, duplicate: true, queued: true });
    await m.drain();
    const item = m.db.rows("knowledge_items")[0] as Record<string, unknown>;
    const md = String(item.content_md);
    expect(m.db.rows("knowledge_items")).toHaveLength(1);
    expect(
      md.startsWith("Für das Agenten-Projekt\n\n## Notiz (2026-10-24)\n\nDemo ab 1:00\n\n---\n\n"),
    ).toBe(true);
    expect(md).toContain("Kontext ist alles.");
    expect((item.metadata as Record<string, unknown>).transcript_missing).toBeFalsy();

    // A third visit without a transcript only merges, as before.
    const third = await (await m.h.POST(postJson(BASE, clip()))).json();
    expect(third).toMatchObject({ duplicate: true, queued: false });
  });
});

describe("media cost guard", () => {
  function guard(maxMinutes: number, budgetEur: number, fetch = fakeFetch([])) {
    const db = new FakeSupabase();
    db.rows("user_settings").push({ user_id: USER_ID, daily_ai_budget_eur: budgetEur });
    const { deps } = setup({ db });
    return createMediaGuard({
      deps,
      userId: USER_ID,
      maxMinutes,
      usdPerSec: DEFAULT_STT_USD_PER_SEC,
      fetch,
    });
  }
  const est = (durationSec: number | null) => ({
    durationSec,
    audioUrl: "https://cdn.test/ep.mp3",
    title: "Folge 1",
  });

  it("lets a short episode through within budget", async () => {
    await expect(guard(90, 5)(est(600))).resolves.toBeUndefined();
  });

  it("refuses above the per-item cap, when switched off, and above the remaining budget", async () => {
    await expect(guard(10, 5)(est(20 * 60))).rejects.toThrow(/20 Minuten lang.*bis 10 Minuten/);
    await expect(guard(0, 5)(est(60))).rejects.toThrow(MediaBudgetError);
    await expect(guard(90, 0.01)(est(600))).rejects.toThrow(/etwa 0,11 €.*noch 0,01 €/);
  });

  it("estimates the length from the file size when the source gives none", async () => {
    const head = fakeFetch([
      {
        match: () => true,
        respond: () =>
          new Response(null, {
            status: 200,
            headers: { "content-length": String(16_000 * 60 * 30) },
          }),
      },
    ]);
    await expect(guard(20, 5, head)(est(null))).rejects.toThrow(/30 Minuten lang/);
  });
});
