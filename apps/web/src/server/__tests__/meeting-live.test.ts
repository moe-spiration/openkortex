import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../auth/api-tokens/secret";
import { createMeetingCoachHandlers, coachQuery } from "../meeting/coach";
import { createMeetingLiveHandlers } from "../meeting/live";
import {
  cardsFromBullets,
  finalTranscript,
  formatSegments,
  isFresh,
  liveMetaOf,
  parseLines,
  type LiveMeta,
} from "../meeting/live-core";
import { authed, mockModel, mockRouter, NOW, postJson, seedFolders, setup, USER_ID } from "./helpers";

const LIVE = "https://kortex.test/api/meeting/live";
const COACH = "https://kortex.test/api/meeting/coach";

function make(coachText = "- **Fakten- & Kontext-Abgleich:** Doc 02 nennt SHA-256 (Doc 02)\n- **Smarter Impuls / Rückfrage:** Wer entscheidet bei Konflikten?\n- **Erkannte Entscheidung / Action Item:** Max schickt das Konzept bis Freitag") {
  const models = mockRouter({ fast: mockModel([coachText]), chat: mockModel([coachText]) });
  const s = setup({ models });
  seedFolders(s.db);
  return { ...s, live: createMeetingLiveHandlers(() => s.deps), coach: createMeetingCoachHandlers(() => s.deps) };
}

async function start(h: ReturnType<typeof make>) {
  const res = await h.live.POST(postJson(LIVE, { action: "start", title: "Q4 Architektur-Sync", started_at: NOW.toISOString(), transcriber: "edenai:deepgram", client: { name: "kortex-desktop", version: "0.2.0" } }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { item_id: string }).item_id;
}

const row = (h: ReturnType<typeof make>, id: string) => h.db.rows("knowledge_items").find((r) => r.id === id)!;

describe("live-core", () => {
  it("formats and parses transcript lines in time order", () => {
    const lines = formatSegments([
      { channel: 1, start_sec: 75.4, text: " Und wer  entscheidet? " },
      { channel: 0, start_sec: 3, text: "Wir hashen jede Datei." },
      { channel: 0, start_sec: 9, text: "   " },
    ]);
    expect(lines).toEqual(["[00:00:03] Ich: Wir hashen jede Datei.", "[00:01:15] Gesprächspartner: Und wer entscheidet?"]);
    expect(parseLines(lines.join("\n"))).toEqual([
      { ts: "00:00:03", sec: 3, channel: 0, who: "Ich", text: "Wir hashen jede Datei." },
      { ts: "00:01:15", sec: 75, channel: 1, who: "Gesprächspartner", text: "Und wer entscheidet?" },
    ]);
  });

  it("maps coaching bullets to cards by label, then by order, and drops empty ones", () => {
    expect(
      cardsFromBullets([
        "**Erkannte Entscheidung / Action Item:** Sven prüft die API bis Montag",
        "**Fakten- & Kontext-Abgleich:** Stimmt mit Doc 02 überein",
        "**Smarter Impuls:** Keine",
      ]),
    ).toEqual([
      { kind: "action", text: "Sven prüft die API bis Montag" },
      { kind: "fact", text: "Stimmt mit Doc 02 überein" },
    ]);
    expect(cardsFromBullets(["Erst das", "Dann die Frage?"]).map((c) => c.kind)).toEqual(["fact", "question"]);
  });

  it("puts marked moments above the transcript for the protocol", () => {
    const clip = (at: number, text: string) => ({ id: String(at), at_sec: at, text, source: "web" as const, created_at: "" });
    expect(finalTranscript("[00:00:01] Ich: Hallo", [clip(90, ""), clip(30, "Budget")])).toBe(
      "## Markierte Momente\n\n- [00:00:30] Budget\n- [00:01:30] Markierter Moment\n\n[00:00:01] Ich: Hallo",
    );
    expect(finalTranscript("x", [])).toBe("x");
  });

  it("treats a session without a recent write as not live", () => {
    const live: LiveMeta = { state: "recording", started_at: "2026-10-23T07:00:00Z", updated_at: "2026-10-23T07:58:00Z", segments: 1, last_sec: 1, clips: [], cards: [] };
    expect(isFresh(live, NOW)).toBe(true);
    expect(isFresh({ ...live, updated_at: "2026-10-23T07:50:00Z" }, NOW)).toBe(false);
    expect(isFresh({ ...live, state: "ended" }, NOW)).toBe(false);
    expect(liveMetaOf({ live: { state: "weird" } })).toBeNull();
  });

  it("builds an OR query from the longer words of the recent talk", () => {
    expect(coachQuery("Wir hashen jede Datei mit SHA-256 und Datei")).toBe("hashen OR datei OR sha-256");
  });
});

describe("/api/meeting/live", () => {
  it("runs a session: start, append, clip, GET, task, end → meeting adapter", async () => {
    const h = make();
    const id = await start(h);
    const item = row(h, id);
    expect(item).toMatchObject({ type: "meeting", status: "processing", folder_path: "00_Inbox", source_platform: "desktop", content_md: "" });
    expect(liveMetaOf(item.metadata)).toMatchObject({ state: "recording", transcriber: "edenai:deepgram" });

    const app = await h.live.POST(
      postJson(LIVE, { action: "append", item_id: id, segments: [{ channel: 0, start_sec: 4, text: "Wir hashen jede Datei mit SHA-256." }, { channel: 1, start_sec: 12, text: "Und wer entscheidet?" }] }),
    );
    expect(await app.json()).toEqual({ ok: true, segments: 2 });
    await h.live.POST(postJson(LIVE, { action: "append", item_id: id, segments: [{ channel: 0, start_sec: 20, text: "Der Nutzer." }] }));
    expect(row(h, id).content_md).toBe("[00:00:04] Ich: Wir hashen jede Datei mit SHA-256.\n[00:00:12] Gesprächspartner: Und wer entscheidet?\n[00:00:20] Ich: Der Nutzer.");

    const clip = await h.live.POST(postJson(LIVE, { action: "clip", item_id: id, at_sec: 13, text: "Konfliktregel klären", source: "desktop" }));
    expect(((await clip.json()) as { clip: { at_sec: number } }).clip.at_sec).toBe(13);

    const got = (await (await h.live.GET(new Request(LIVE, authed()))).json()) as { session: { item_id: string; tail: unknown[]; clips: unknown[]; segments: number } };
    expect(got.session).toMatchObject({ item_id: id, segments: 3 });
    expect(got.session.tail).toHaveLength(3);
    expect(got.session.clips).toHaveLength(1);

    const task = await h.live.POST(postJson(LIVE, { action: "task", item_id: id, title: "Konzept an Sven", at_sec: 20 }));
    expect(task.status).toBe(200);
    expect(h.db.rows("action_items").at(-1)).toMatchObject({ user_id: USER_ID, title: "Konzept an Sven", source_timestamp_sec: 20 });

    const end = await h.live.POST(postJson(LIVE, { action: "end", item_id: id }));
    expect(await end.json()).toEqual({ ok: true, item_id: id, queued: true });
    expect(liveMetaOf(row(h, id).metadata)?.state).toBe("ended");
    await h.drain();
    // Ended: no live card any more; a second end is a no-op.
    expect(((await (await h.live.GET(new Request(LIVE, authed()))).json()) as { session: unknown }).session).toBeNull();
    expect(await (await h.live.POST(postJson(LIVE, { action: "end", item_id: id }))).json()).toMatchObject({ queued: false });
    expect(await (await h.live.POST(postJson(LIVE, { action: "append", item_id: id, segments: [] }))).json()).toMatchObject({ ok: false });
  });

  it("ends an empty session without a model run, and uses a re-transcribed transcript", async () => {
    const h = make();
    const empty = await start(h);
    expect(await (await h.live.POST(postJson(LIVE, { action: "end", item_id: empty }))).json()).toMatchObject({ queued: false });
    expect(row(h, empty).status).toBe("processed");

    const other = await start(h);
    await h.live.POST(postJson(LIVE, { action: "end", item_id: other, transcript: "[00:00:01] Ich: Nachträglich transkribiert." }));
    expect(row(h, other).content_md).toBe("[00:00:01] Ich: Nachträglich transkribiert.");
  });

  it("rejects unknown items, other types and bad bodies", async () => {
    const h = make();
    h.db.rows("knowledge_items").push({ id: "33333333-3333-4333-8333-333333333333", user_id: USER_ID, type: "note", title: "x", metadata: {} });
    for (const body of [
      { action: "clip", item_id: "33333333-3333-4333-8333-333333333333" },
      { action: "clip", item_id: "44444444-4444-4444-8444-444444444444" },
    ])
      expect((await h.live.POST(postJson(LIVE, body))).status).toBe(404);
    expect((await h.live.POST(postJson(LIVE, { action: "fly" }))).status).toBe(400);
    expect((await h.live.POST(postJson(LIVE, { action: "append", item_id: "nope", segments: [] }))).status).toBe(400);
  });
});

describe("/api/meeting/coach", () => {
  it("answers with cards from the meeting_coach route and stores them on the session", async () => {
    const h = make();
    const id = await start(h);
    await h.live.POST(postJson(LIVE, { action: "append", item_id: id, segments: [{ channel: 1, start_sec: 30, text: "Wie gehen wir mit Konflikten beim Vault-Sync um?" }] }));
    const res = await h.coach.POST(postJson(COACH, { item_id: id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cards: Array<{ kind: string; text: string }> };
    expect(body.cards.map((c) => c.kind)).toEqual(["fact", "question", "action"]);
    expect(body.cards[1]!.text).toBe("Wer entscheidet bei Konflikten?");
    const meta = row(h, id).metadata as { coaching: string; live: LiveMeta };
    expect(meta.coaching).toBe("Doc 02 nennt SHA-256 (Doc 02)");
    expect(meta.live.cards).toHaveLength(3);
    expect(meta.live.coached_segments).toBe(1);
  });

  it("skips the model while nothing was said", async () => {
    const h = make();
    const id = await start(h);
    expect(await (await h.coach.POST(postJson(COACH, { item_id: id }))).json()).toMatchObject({ ok: true, cards: [], skipped: "no_transcript" });
  });
});

describe("live meeting with a personal API token (desktop default sign-in)", () => {
  function seedPersonal(h: ReturnType<typeof make>, scopes: string[]) {
    const raw = generateToken();
    h.db.rows("api_tokens").push({
      id: `tok-${scopes.join("-")}`,
      user_id: USER_ID,
      name: "Desktop",
      token_hash: hashToken(raw),
      token_prefix: raw.slice(0, 11),
      scopes,
      created_at: NOW.toISOString(),
      last_used_at: null,
      expires_at: null,
      revoked_at: null,
    });
    return raw;
  }

  it("runs start, append, end with the ingest scope as the token owner, but never reads a session back", async () => {
    const h = make();
    const token = seedPersonal(h, ["ingest"]);
    const res = await h.live.POST(postJson(LIVE, { action: "start", title: "Sync", client: { name: "kortex-desktop", version: "0.4.0" } }, { token }));
    expect(res.status).toBe(201);
    const { item_id } = (await res.json()) as { item_id: string };
    expect(row(h, item_id)).toMatchObject({ user_id: USER_ID, type: "meeting", source_platform: "desktop" });
    const app = await h.live.POST(postJson(LIVE, { action: "append", item_id, segments: [{ channel: 0, start_sec: 2, text: "Hallo zusammen." }] }, { token }));
    expect(await app.json()).toEqual({ ok: true, segments: 1 });
    expect((await h.live.GET(new Request(LIVE, authed({ token })))).status).toBe(403);
    // Coaching reads the vault: a capture-only token is refused.
    expect((await h.coach.POST(postJson(COACH, { item_id }, { token }))).status).toBe(401);
    expect(await (await h.live.POST(postJson(LIVE, { action: "end", item_id }, { token }))).json()).toMatchObject({ ok: true, queued: true });
  });

  it("coaches with a token that may also search the vault", async () => {
    const h = make();
    const token = seedPersonal(h, ["ingest", "search"]);
    const id = await start(h);
    await h.live.POST(postJson(LIVE, { action: "append", item_id: id, segments: [{ channel: 1, start_sec: 30, text: "Wie gehen wir mit Konflikten beim Vault-Sync um?" }] }, { token }));
    const res = await h.coach.POST(postJson(COACH, { item_id: id }, { token }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { cards: unknown[] }).cards).toHaveLength(3);
  });
});
