import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connect, FIXED_NOW } from "./helpers";

// MCP voll Lesen/Schreiben ohne siebtes Tool: Dedup beim Anlegen, Update per id, Metadaten-Filter,
// Task-Update. Plus der konversationelle Ablauf "Buch XYZ gelesen, hat mir gefallen".

let t: Awaited<ReturnType<typeof connect>>;
beforeEach(async () => {
  t = await connect();
});
afterEach(() => t.close());

const call = async (name: string, args: Record<string, unknown>) => t.call(name, args);
const save = async (args: Record<string, unknown>) => (await call("brain_save_item", args)).json;

describe("brain_save_item dedup", () => {
  it("the same URL twice is one item; the second save merges tags", async () => {
    const a = await save({
      title: "MCP erklärt",
      content_md: "Artikel",
      source_url: "https://www.heise.de/mcp?utm_source=x",
      tags: ["ai"],
    });
    const b = await save({
      title: "MCP erklärt (Kopie)",
      content_md: "Artikel",
      source_url: "https://heise.de/mcp/",
      tags: ["lesen"],
    });
    expect(b.id).toBe(a.id);
    expect(b.duplicate).toMatchObject({ reason: "source_url" });
    expect(b.tags).toEqual(["ai", "lesen"]);
    expect(b.title).toBe("MCP erklärt");
    expect(t.repo.items.size).toBe(1);
  });

  it("the same ISBN or object title is one item", async () => {
    const dune = await save({
      title: "Dune",
      content_md: "",
      type: "book",
      metadata: { isbn: "978-0441013593" },
    });
    const again = await save({
      title: "Dune – Der Wüstenplanet",
      content_md: "",
      type: "book",
      metadata: { isbn: "9780441013593", author: "Frank Herbert" },
    });
    expect(again).toMatchObject({ id: dune.id, duplicate: { reason: "external_id" } });
    expect(t.repo.items.get(dune.id)?.metadata).toMatchObject({ author: "Frank Herbert" });
    const ada = await save({ title: "Ada Lovelace", content_md: "", type: "person" });
    expect((await save({ title: "ada lovelace", content_md: "", type: "person" })).id).toBe(ada.id);
  });

  it("validates metadata against the registry", async () => {
    const res = await call("brain_save_item", {
      title: "X",
      content_md: "",
      type: "book",
      metadata: { status: "gelesen" },
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/want_to_read\|reading\|read/);
    expect((await call("brain_save_item", { content_md: "no title" })).text).toMatch(
      /"title" is required/,
    );
  });
});

describe("brain_save_item update (id)", () => {
  it("updates only the given fields and merges metadata (null removes)", async () => {
    const book = await save({
      title: "Dune",
      content_md: "Notizen",
      type: "book",
      tags: ["sci-fi"],
      metadata: { status: "want_to_read", author: "Frank Herbert", rating: 3 },
    });
    const res = (
      await call("brain_save_item", {
        id: book.id,
        metadata: { status: "read", feedback: "Großartig", rating: null },
        tags: ["klassiker"],
        remind_at: "2027-01-01",
      })
    ).json;
    expect(res).toMatchObject({
      updated: true,
      id: book.id,
      title: "Dune",
      tags: ["sci-fi", "klassiker"],
      remind_at: "2027-01-01T00:00:00.000Z",
      metadata: { status: "read", feedback: "Großartig", author: "Frank Herbert" },
    });
    expect(res.metadata).not.toHaveProperty("rating");
    expect(t.repo.items.get(book.id)?.content_md).toBe("Notizen");
    expect(t.repo.items.size).toBe(1);
  });

  it("rejects an unknown id and invalid metadata for the item's type", async () => {
    expect(
      (await call("brain_save_item", { id: "6f1c1f9e-1d4b-4c49-9b1a-5d0c3c1b2a10", title: "x" }))
        .text,
    ).toMatch(/not found/);
    const movie = await save({ title: "Dune", content_md: "", type: "movie" });
    expect(
      (await call("brain_save_item", { id: movie.id, metadata: { status: "read" } })).text,
    ).toMatch(/to_watch\|watched/);
  });
});

describe("conversational status update", () => {
  it('"Dune gelesen, hat mir gefallen": search by type + status, then save(id) — no new note', async () => {
    await save({
      title: "Dune",
      content_md: "",
      type: "book",
      metadata: { status: "want_to_read" },
    });
    await save({
      title: "Neuromancer",
      content_md: "",
      type: "book",
      metadata: { status: "read" },
    });

    const toRead = (await call("brain_search", { types: ["book"], status: "want_to_read" })).json;
    expect(toRead).toMatchObject({ mode: "filter", count: 1 });
    expect(toRead.results[0]).toMatchObject({
      title: "Dune",
      metadata: { status: "want_to_read" },
    });

    const hit = (await call("brain_search", { query: "Dune", type: "book" })).json.results[0];
    await call("brain_save_item", {
      id: hit.item_id,
      metadata: { status: "read", feedback: "Hat mir gefallen", rating: 9 },
    });
    expect(t.repo.items.size).toBe(2);
    const read = (await call("brain_search", { type: "book", metadata: { status: "read" } })).json;
    expect(read.results.map((r: { title: string }) => r.title).sort()).toEqual([
      "Dune",
      "Neuromancer",
    ]);
  });

  it("needs a query or a filter", async () => {
    expect((await call("brain_search", {})).text).toMatch(/query or at least one filter/);
  });
});

describe("brain_manage_tasks update", () => {
  it("edits title, priority, due date, timeframe, context, project and export state", async () => {
    const project = await save({ title: "Kortex", content_md: "", type: "project" });
    const task = (
      await call("brain_manage_tasks", {
        action: "create",
        title: "Release",
        timeframe: "this_week",
      })
    ).json.task;
    expect(task).toMatchObject({ timeframe: "this_week", exported_at: null });
    const updated = (
      await call("brain_manage_tasks", {
        action: "update",
        task_id: task.id,
        title: "Release 0.4",
        priority: "high",
        due_date: "2026-11-05",
        context: "@computer",
        project_id: project.id,
        exported: true,
      })
    ).json.task;
    expect(updated).toMatchObject({
      title: "Release 0.4",
      priority: "high",
      due_date: "2026-11-05T00:00:00.000Z",
      context: "@computer",
      project_item_id: project.id,
      exported_at: FIXED_NOW.toISOString(),
    });
    const cleared = (
      await call("brain_manage_tasks", {
        action: "update",
        task_id: task.id,
        due_date: null,
        exported: false,
      })
    ).json.task;
    expect(cleared).toMatchObject({ due_date: null, exported_at: null });
    expect((await call("brain_manage_tasks", { action: "update", task_id: task.id })).text).toMatch(
      /Nothing to update/,
    );
  });
});

describe("brain_manage_tasks rich fields", () => {
  it("normalises the timeframe, rejects bad ones and non-project parents, and filters the list", async () => {
    const project = await save({ title: "Kortex", content_md: "", type: "project" });
    const note = await save({ title: "Just a note", content_md: "x", type: "note" });
    const a = (
      await call("brain_manage_tasks", {
        action: "create",
        title: "A",
        timeframe: "diese Woche",
        context: "  Vom   Sync ",
        project_id: project.id,
      })
    ).json.task;
    expect(a).toMatchObject({
      timeframe: "this_week",
      context: "Vom Sync",
      project_item_id: project.id,
      external_ref: null,
    });
    const b = (
      await call("brain_manage_tasks", { action: "create", title: "B", timeframe: "2026-11-05" })
    ).json.task;
    await call("brain_manage_tasks", { action: "update", task_id: b.id, exported: true });

    expect(
      (await call("brain_manage_tasks", { action: "create", title: "C", timeframe: "bald" })).text,
    ).toMatch(/Invalid timeframe/);
    expect(
      (await call("brain_manage_tasks", { action: "create", title: "C", project_id: note.id }))
        .text,
    ).toMatch(/not a project or goal/);

    const titles = async (f: Record<string, unknown>) =>
      (
        (await call("brain_manage_tasks", { action: "list", ...f })).json.tasks as {
          title: string;
        }[]
      ).map((x) => x.title);
    expect(await titles({ project_id: project.id })).toEqual(["A"]);
    expect(await titles({ timeframe: "this_week" })).toEqual(["A"]);
    expect(await titles({ timeframe: "2026-11-05" })).toEqual(["B"]);
    expect(await titles({ exported: true })).toEqual(["B"]);
    expect(await titles({ exported: false })).toEqual(["A"]);
  });
});

describe("brain_search remind_due_by", () => {
  it("lists only items whose reminder is due, oldest first", async () => {
    const past = await save({ title: "Faellig", content_md: "a", type: "note" });
    const future = await save({ title: "Spaeter", content_md: "b", type: "note" });
    await save({ title: "Ohne", content_md: "c", type: "note" });
    await call("brain_save_item", { id: past.id, remind_at: "2026-01-01T08:00:00Z" });
    await call("brain_save_item", { id: future.id, remind_at: "2099-01-01T08:00:00Z" });
    const res = (await call("brain_search", { remind_due_by: "2026-06-01T00:00:00Z" })).json;
    expect(res.results.map((r: { title: string }) => r.title)).toEqual(["Faellig"]);
    expect(res.results[0].remind_at).toBe("2026-01-01T08:00:00.000Z");
    const bad = await call("brain_search", { remind_due_by: "gestern" });
    expect(bad.isError).toBe(true);
  });
});
