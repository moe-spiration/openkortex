import { describe, expect, it } from "vitest";
import { createScratchpadHandlers } from "../scratchpad/handler";
import { appendArchive, appendEntry, entryId, formatEntry, initialDoc, parseEntries, removeEntries } from "../scratchpad/format";
import { CleanupOutputSchema, DecisionSchema } from "../scratchpad/schema";
import { isScratchpadItem } from "../scratchpad/targets";
import { sanitizeSuggestions, scratchpadArchiveId, scratchpadId } from "../scratchpad/service";
import { FakeSupabase } from "./fake-supabase";
import { authed, mockModel, mockRouter, postJson, setup, USER_ID } from "./helpers";

const BASE = "https://kortex.test/api/scratchpad";
const PERSON = "22222222-2222-4222-8222-222222222222";

describe("scratchpad format", () => {
  it("round-trips multi-line entries and code blocks", () => {
    const text = "Nummer von Anna\n```\n+49 170 1234567\n```\n\nAbends anrufen";
    const md = appendEntry(initialDoc(), { at: "2026-10-31 14:05", text });
    const [e] = parseEntries(md);
    expect(e).toEqual({ id: entryId("2026-10-31 14:05", text), at: "2026-10-31 14:05", text });
    expect(formatEntry({ at: "2026-10-31 14:05", text })).toContain("\n  +49 170 1234567");
  });

  it("parses several entries and ignores the heading/preface", () => {
    let md = initialDoc();
    md = appendEntry(md, { at: "2026-10-31 09:00", text: "eins" });
    md = appendEntry(md, { at: "2026-10-31 09:01", text: "zwei\nzeile 2" });
    expect(parseEntries(md).map((e) => e.text)).toEqual(["eins", "zwei\nzeile 2"]);
  });

  it("removes only the chosen entries and leaves the rest untouched", () => {
    let md = initialDoc();
    md = appendEntry(md, { at: "2026-10-31 09:00", text: "eins" });
    md = appendEntry(md, { at: "2026-10-31 09:01", text: "zwei\nzeile 2" });
    md = appendEntry(md, { at: "2026-10-31 09:02", text: "drei" });
    const [, two] = parseEntries(md);
    const out = removeEntries(md, new Set([two!.id]));
    expect(parseEntries(out).map((e) => e.text)).toEqual(["eins", "drei"]);
    expect(out).toContain("# Scratchpad");
    expect(out).not.toContain("zeile 2");
  });
});

describe("cleanup schema", () => {
  it("accepts valid suggestions and rejects unknown actions / non-uuid targets", () => {
    expect(CleanupOutputSchema.safeParse({ suggestions: [{ entry_id: "a", action: "task", title: "X" }] }).success).toBe(true);
    expect(CleanupOutputSchema.safeParse({ suggestions: [{ entry_id: "a", action: "delete" }] }).success).toBe(false);
    expect(DecisionSchema.safeParse({ entry_id: "a", action: "object", target_item_id: "nope" }).success).toBe(false);
    expect(DecisionSchema.safeParse({ entry_id: "a", action: "keep" }).success).toBe(false);
  });

  it("sanitize: one suggestion per entry, foreign ids dropped, bad targets become keep", () => {
    const entries = [
      { id: "e1", at: "t", text: "ruf Anna an" },
      { id: "e2", at: "t", text: "irgendwas" },
    ];
    const out = sanitizeSuggestions(
      [
        { entry_id: "e1", action: "object", target_item_id: "11111111-1111-4111-8111-aaaaaaaaaaaa" },
        { entry_id: "zzz", action: "task", title: "x" },
      ],
      entries,
      new Set([PERSON]),
    );
    expect(out).toEqual([
      { entry_id: "e1", action: "keep", reason: "Ziel nicht gefunden" },
      { entry_id: "e2", action: "keep", reason: "Kein Vorschlag" },
    ]);
  });
});

function make(suggestions: unknown = { suggestions: [] }) {
  const db = new FakeSupabase({
    knowledge_items: [
      { id: PERSON, user_id: USER_ID, type: "person", title: "Anna", content_md: "# Anna", updated_at: "2026-10-20T10:00:00Z" },
    ],
  });
  const s = setup({ db, models: mockRouter({ fast: mockModel([suggestions]), chat: mockModel([suggestions]) }) });
  return { ...s, h: createScratchpadHandlers(() => s.deps) };
}

const padRows = (db: FakeSupabase) => db.rows("knowledge_items").filter((r) => r.id === scratchpadId(USER_ID));
const padCount = (db: FakeSupabase) => parseEntries(String(padRows(db)[0]?.content_md ?? "")).length;

describe("/api/scratchpad", () => {
  it("creates the single document on first entry and appends afterwards", async () => {
    const { h, db } = make();
    const r1 = await (await h.POST(postJson(BASE, { text: "erster" }))).json();
    expect(r1.entries).toHaveLength(1);
    const r2 = await (await h.POST(postJson(BASE, { text: "zweiter\n```\ncode\n```" }))).json();
    expect(r2.entries.map((e: { text: string }) => e.text)).toEqual(["erster", "zweiter\n```\ncode\n```"]);
    const rows = padRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "note", folder_path: "00_Inbox", metadata: { scratchpad: true } });
    const list = await (await h.GET(new Request(BASE, authed()))).json();
    expect(list.entries).toHaveLength(2);
  });

  it("parallel first entries yield one document and keep both entries", async () => {
    const { h, db } = make();
    const rs = await Promise.all([h.POST(postJson(BASE, { text: "a" })), h.POST(postJson(BASE, { text: "b" }))]);
    
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(padRows(db)).toHaveLength(1);
    const list = await (await h.GET(new Request(BASE, authed()))).json();
    expect(list.entries.map((e: { text: string }) => e.text).sort()).toEqual(["a", "b"]);
  });

  it("rejects empty text", async () => {
    const { h } = make();
    expect((await h.POST(postJson(BASE, { text: "" }))).status).toBe(400);
  });

  it("cleanup suggests, apply creates note/task/object entry and removes only accepted lines", async () => {
    const { h, db } = make();
    for (const t of ["Idee: Blog ueber RAG", "Steuer abgeben", "Anna mag Kaffee", "Muell", "unklar"])
      await h.POST(postJson(BASE, { text: t }));
    const { entries } = await (await h.GET(new Request(BASE, authed()))).json();
    const id = (i: number) => entries[i].id as string;
    const model = {
      suggestions: [
        { entry_id: id(0), action: "note", title: "Blog RAG" },
        { entry_id: id(1), action: "task", title: "Steuer abgeben" },
        { entry_id: id(2), action: "object", target_item_id: PERSON },
        { entry_id: id(3), action: "discard" },
      ],
    };
    const s2 = setup({ db, models: mockRouter({ fast: mockModel([model]), chat: mockModel([model]) }) });
    const h2 = createScratchpadHandlers(() => s2.deps);
    const c = await (await h2.cleanup(postJson(`${BASE}/cleanup`, {}))).json();
    expect(c.suggestions.map((x: { action: string }) => x.action)).toEqual(["note", "task", "object", "discard", "keep"]);
    expect(padCount(db)).toBe(5); // cleanup alone changes nothing

    const a = await (
      await h2.apply(
        postJson(`${BASE}/apply`, {
          decisions: [
            { entry_id: id(0), action: "note", title: "Blog RAG" },
            { entry_id: id(1), action: "task", title: "Steuer abgeben" },
            { entry_id: id(2), action: "object", target_item_id: PERSON },
            { entry_id: id(3), action: "discard" },
          ],
        }),
      )
    ).json();
    expect(a.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(a.entries.map((e: { text: string }) => e.text)).toEqual(["unklar"]);
    expect(db.rows("knowledge_items").some((r) => r.title === "Blog RAG" && r.type === "note")).toBe(true);
    expect(db.rows("action_items")).toMatchObject([{ title: "Steuer abgeben", status: "open", user_id: USER_ID }]);
    expect(db.rows("knowledge_items").find((r) => r.id === PERSON)!.content_md).toContain("Anna mag Kaffee");
    expect(db.rows("knowledge_items").some((r) => r.title === "Muell")).toBe(false); // discard never creates or deletes items
    expect(padRows(db)).toHaveLength(1);
    // Cleaned-up lines are kept as a Markdown archive note (same bullet format).
    const archive = db.rows("knowledge_items").find((r) => r.id === scratchpadArchiveId(USER_ID))!;
    expect(archive).toMatchObject({ folder_path: "10_Notes", metadata: { scratchpad_archive: true } });
    expect(parseEntries(archive.content_md as string)).toHaveLength(4);
  });

  it("deletes a single saved entry without AI cleanup (discard) and archives it", async () => {
    const { h, db } = make();
    for (const t of ["behalten", "weg damit"]) await h.POST(postJson(BASE, { text: t }));
    const { entries } = await (await h.GET(new Request(BASE, authed()))).json();
    const res = await (await h.apply(postJson(`${BASE}/apply`, { decisions: [{ entry_id: entries[1].id, action: "discard" }] }))).json();
    expect(res.results).toEqual([expect.objectContaining({ entry_id: entries[1].id, ok: true })]);
    expect(res.entries.map((e: { text: string }) => e.text)).toEqual(["behalten"]);
    const list = await (await h.GET(new Request(BASE, authed()))).json();
    expect(list.entries.map((e: { text: string }) => e.text)).toEqual(["behalten"]);
    const archive = db.rows("knowledge_items").find((r) => r.id === scratchpadArchiveId(USER_ID))!;
    expect(parseEntries(archive.content_md as string).map((e) => e.text)).toEqual(["weg damit"]);
  });

  it("W-03: when the archive cannot be written, the entry stays in the pad and the result says so", async () => {
    const { h, db } = make();
    await h.POST(postJson(BASE, { text: "nicht verlieren" }));
    const { entries } = await (await h.GET(new Request(BASE, authed()))).json();
    db.failNext("knowledge_items", "insert", "archive down");
    const res = await (await h.apply(postJson(`${BASE}/apply`, { decisions: [{ entry_id: entries[0].id, action: "discard" }] }))).json();
    expect(res.results[0]).toMatchObject({ ok: false, error: expect.stringContaining("Archiv") });
    expect(res.entries.map((e: { text: string }) => e.text)).toEqual(["nicht verlieren"]);
  });

  it("a failing entry stays in the pad", async () => {
    const { h } = make();
    await h.POST(postJson(BASE, { text: "x" }));
    const { entries } = await (await h.GET(new Request(BASE, authed()))).json();
    const res = await (
      await h.apply(
        postJson(`${BASE}/apply`, {
          decisions: [{ entry_id: entries[0].id, action: "object", target_item_id: "33333333-3333-4333-8333-333333333333" }],
        }),
      )
    ).json();
    expect(res.results[0]).toMatchObject({ ok: false });
    expect(res.entries).toHaveLength(1);
  });
});

describe("scratchpad archive format", () => {
  it("appendArchive is idempotent and parses back", () => {
    const es = [
      { at: "2026-10-31 09:00", text: "eins\nzwei" },
      { at: "2026-10-31 09:05", text: "drei" },
    ];
    const once = appendArchive("# Scratchpad-Archiv\n\n", es);
    expect(appendArchive(once, es)).toBe(once);
    expect(parseEntries(once).map((e) => e.text)).toEqual(["eins\nzwei", "drei"]);
  });
});

describe("scratchpad identity (dedup must never merge it)", () => {
  it("the document carries metadata.scratchpad and isScratchpadItem recognises it", async () => {
    const { h, db } = make();
    await h.POST(postJson(BASE, { text: "x" }));
    const row = padRows(db)[0]!;
    expect(isScratchpadItem(row)).toBe(true);
    expect(isScratchpadItem({ metadata: {} })).toBe(false);
    // A user note that merely has the same title is not the scratchpad.
    expect(isScratchpadItem({ metadata: null })).toBe(false);
  });
});
