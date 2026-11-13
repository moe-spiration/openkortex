import { describe, expect, it } from "vitest";
import { createIngestHandlers } from "../ingest/handler";
import { parseStatusCapture } from "../ingest/status-capture";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, postJson, seedFolders, setup, USER_ID } from "./helpers";

// "Film X gesehen" per Sprache oder Quick-Capture aktualisiert den bestehenden Eintrag
// (Dedup + Update, Status wird ergänzt, nichts überschrieben), statt eine Notiz anzulegen.

const BASE = "https://kortex.test/api/ingest";
const MOVIE = "66666666-6666-4666-8666-000000000010";

function make() {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: MOVIE,
        user_id: USER_ID,
        type: "movie",
        title: "Dune",
        status: "processed",
        folder_path: "30_Clippings/Movies",
        is_manual_placement: false,
        content_md: "Sci-Fi",
        metadata: { status: "to_watch", year: 2021, imdb_id: "tt1160419", feedback: "Lang erwartet" },
        updated_at: "2026-10-20T10:00:00Z",
      },
    ],
  });
  seedFolders(db);
  const s = setup({ models: mockRouter({ fast: mockModel([{}]) }), db });
  return { ...s, h: createIngestHandlers(() => s.deps) };
}

describe("parseStatusCapture", () => {
  it.each([
    ["Dune gesehen", { title: "Dune", type: "movie", status: "watched", feedback: null }],
    ["Ich habe Dune gesehen, hat mir gefallen", { title: "Dune", type: "movie", status: "watched", feedback: "hat mir gefallen" }],
    ["Dune habe ich gerade geschaut", { title: "Dune", type: "movie", status: "watched", feedback: null }],
    ["Das Buch Der Marsianer gelesen", { title: "Der Marsianer", type: "book", status: "read", feedback: null }],
    ["AirPods gekauft", { title: "AirPods", type: "product", status: "owned", feedback: null }],
  ])("%s", (text, expected) => {
    expect(parseStatusCapture(text)).toEqual(expected);
  });

  it("ignores everything that is not a short status sentence", () => {
    expect(parseStatusCapture("Idee: MCP-Tool für Rezepte")).toBeNull();
    expect(parseStatusCapture("Zeile eins\nDune gesehen")).toBeNull();
    expect(parseStatusCapture("x ".repeat(100) + "gesehen")).toBeNull();
  });
});

describe("note ingest with a status sentence", () => {
  it("updates the existing movie, keeps its data, creates no note, queues nothing", async () => {
    const { h, db } = make();
    const res = await (
      await h.POST(postJson(BASE, { kind: "note", content_md: "Dune gesehen, richtig stark" }))
    ).json();
    expect(res).toMatchObject({ ok: true, item_id: MOVIE, type: "movie", duplicate: true, queued: false });
    expect(db.rows("knowledge_items")).toHaveLength(1);
    expect(db.rows("knowledge_items")[0]?.metadata).toMatchObject({
      status: "watched",
      year: 2021,
      imdb_id: "tt1160419",
      feedback: "Lang erwartet", // existing feedback is not overwritten
    });
  });

  it("works for voice captures, too", async () => {
    const { h, db } = make();
    const res = await (
      await h.POST(
        postJson(BASE, { kind: "note", content_md: "Ich habe Dune gesehen", type_hint: "voice", title: "Sprachnotiz 0:03" }),
      )
    ).json();
    expect(res).toMatchObject({ item_id: MOVIE, duplicate: true, queued: false });
    expect(db.rows("knowledge_items")).toHaveLength(1);
  });

  it("without a matching entry it is stored as a note as before", async () => {
    const { h, db } = make();
    const res = await (
      await h.POST(postJson(BASE, { kind: "note", content_md: "Oppenheimer gesehen" }))
    ).json();
    expect(res).toMatchObject({ type: "note", duplicate: false, queued: true });
    expect(db.rows("knowledge_items")).toHaveLength(2);
  });
});
