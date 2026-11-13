import { readdir, rename, rm, writeFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalFromItem, checksumOf, parseMarkdown } from "../src/frontmatter";
import { exists } from "../src/fs-utils";
import { createHarness, note, type Harness } from "./helpers";

let h: Harness;
afterEach(async () => {
  await h?.cleanup();
});

async function started(extra = {}) {
  h = await createHarness(extra);
  await h.engine.start();
  await h.settle();
  return h;
}

/** Push a new local file the way the watcher would. */
async function addLocal(rel: string, text: string) {
  await h.write(rel, text);
  await h.engine.handleLocalFile(rel);
  await h.settle();
}

describe("bootstrap", () => {
  it("creates the vault tree and mirrors the remote system folders", async () => {
    await started();
    for (const rel of [
      "00_Inbox",
      "10_Notes/Daily",
      "40_AI_Memories",
      "70_Objects/People",
      "70_Objects/Goals",
      "90_Digests",
    ]) {
      expect(await exists(h.abs(rel))).toBe(true);
    }
    expect(h.store.folderByPath("70_Objects/Tools")?.is_system_default).toBe(true);
    // Local dirs that already exist as system folders don't create duplicates.
    expect(h.store.calls.createFolder).toBe(0);
  });
});

describe("cloud -> local", () => {
  it("writes a new remote item as <folder_path>/<slug>.md with frontmatter + checksum", async () => {
    await started();
    const item = h.store.seedItem({
      title: "Q4 Sync",
      slug: "q4-sync",
      folder_path: "20_Meetings/Automotive",
      type: "meeting",
      content_md: "# Summary\n\nDone.",
      tags: ["ai/mcp"],
    });
    await h.settle();
    const rel = "20_Meetings/Automotive/q4-sync.md";
    const data = await h.readData(rel);
    expect(data).toMatchObject({
      id: item.id,
      title: "Q4 Sync",
      type: "meeting",
      tags: ["ai/mcp"],
    });
    expect(data.checksum).toBe(checksumOf(canonicalFromItem(item)));
    expect(parseMarkdown(await h.read(rel)).body).toBe("# Summary\n\nDone.");
  });

  it("puts domain objects under 70_Objects/<Type>/", async () => {
    await started();
    h.store.seedItem({
      title: "Ada Lovelace",
      slug: "ada-lovelace",
      type: "person",
      folder_path: "70_Objects/People",
      metadata: { role: "Engineer" },
    });
    await h.settle();
    const data = await h.readData("70_Objects/People/ada-lovelace.md");
    expect(data).toMatchObject({ type: "person", metadata: { role: "Engineer" } });
  });

  it("does not echo a pulled file back to the cloud", async () => {
    await started();
    const item = h.store.seedItem({ title: "Echo", folder_path: "10_Notes", content_md: "v1" });
    await h.settle();
    const writes = h.events["local-write"].length;
    // The watcher would now report the daemon's own write (twice: add + change).
    await h.engine.handleLocalFile("10_Notes/echo.md");
    await h.engine.handleLocalFile("10_Notes/echo.md");
    await h.settle();
    expect(h.store.calls.upsertItem).toBe(0);
    expect(h.events["local-write"].length).toBe(writes);
    expect(h.store.items.get(item.id)?.content_md).toBe("v1");
  });

  it("applies remote edits, renames and moves", async () => {
    await started();
    const item = h.store.seedItem({
      title: "Plan",
      slug: "plan",
      folder_path: "10_Notes",
      content_md: "v1",
    });
    await h.settle();
    h.store.editItem(item.id, { content_md: "v2" });
    await h.settle();
    expect(parseMarkdown(await h.read("10_Notes/plan.md")).body).toBe("v2");

    h.store.editItem(item.id, { slug: "plan-2027" });
    await h.settle();
    expect(await exists(h.abs("10_Notes/plan.md"))).toBe(false);
    expect(parseMarkdown(await h.read("10_Notes/plan-2027.md")).body).toBe("v2");

    h.store.editItem(item.id, { folder_path: "10_Notes/Strategy" });
    await h.settle();
    expect(await exists(h.abs("10_Notes/plan-2027.md"))).toBe(false);
    expect((await h.readData("10_Notes/Strategy/plan-2027.md")).folder_path).toBe(
      "10_Notes/Strategy",
    );
    expect(h.store.calls.upsertItem).toBe(0);
  });

  it("moves the local file to .kortex/trash when the remote item is deleted or archived", async () => {
    await started();
    const a = h.store.seedItem({ title: "A", folder_path: "10_Notes" });
    const b = h.store.seedItem({ title: "B", folder_path: "10_Notes" });
    await h.settle();
    h.store.removeItem(a.id);
    h.store.editItem(b.id, { status: "archived" });
    await h.settle();
    expect(await exists(h.abs("10_Notes/a.md"))).toBe(false);
    expect(await exists(h.abs("10_Notes/b.md"))).toBe(false);
    const trash = await readdir(h.abs(".kortex/trash"));
    expect(trash).toHaveLength(2);
    expect(h.events["local-removed"].map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("gives colliding slugs a -<id8> suffix and stays stable", async () => {
    await started();
    const one = h.store.seedItem({ title: "Same", slug: "same", folder_path: "10_Notes" });
    const two = h.store.seedItem({ title: "Same", slug: "same", folder_path: "10_Notes" });
    await h.settle();
    expect((await h.readData("10_Notes/same.md")).id).toBe(one.id);
    expect((await h.readData(`10_Notes/same-${two.id.slice(0, 8)}.md`)).id).toBe(two.id);
    const stats = await h.engine.reconcile();
    expect(stats).toMatchObject({ pulled: 0, pushed: 0, conflicts: 0 });
  });

  it("writes Windows-unsafe slugs to safe file names and keeps the DB slug on push", async () => {
    await started();
    const item = h.store.seedItem({ title: "Q&A", slug: 'Q&A: "what?"', folder_path: "10_Notes" });
    await h.settle();
    const rel = "10_Notes/Q&A- -what--.md";
    expect((await h.readData(rel)).id).toBe(item.id);
    await h.write(rel, (await h.read(rel)).replace(/\n$/, "\nedited\n"));
    await h.engine.handleLocalFile(rel);
    await h.settle();
    expect(h.store.items.get(item.id)?.slug).toBe('Q&A: "what?"');
    expect(h.store.items.get(item.id)?.content_md).toBe("edited");
  });

  it("creates remote folders locally", async () => {
    await started();
    const parent = h.store.seedFolder(
      "10_Notes/Automotive",
      h.store.folderByPath("10_Notes")?.id ?? null,
    );
    h.store.seedFolder("10_Notes/Automotive/Mercedes-AMG", parent.id);
    await h.settle();
    expect(await exists(h.abs("10_Notes/Automotive/Mercedes-AMG"))).toBe(true);
  });
});

describe("local -> cloud", () => {
  it("creates an item from a new file, writes the id back once, no echo loop", async () => {
    await started();
    await addLocal("10_Notes/Idea.md", "Just a thought\n");
    expect(h.store.calls.upsertItem).toBe(1);
    const item = h.store.itemByTitle("Idea");
    expect(item).toMatchObject({
      slug: "Idea",
      folder_path: "10_Notes",
      content_md: "Just a thought",
      type: "note",
    });
    const data = await h.readData("10_Notes/Idea.md");
    expect(data.id).toBe(item?.id);
    expect(data.checksum).toBe(item?.local_file_hash);
    expect(h.events["local-write"]).toHaveLength(1);

    // Watcher echo of the id write-back + Realtime echo of the upsert: nothing happens.
    await h.engine.handleLocalFile("10_Notes/Idea.md");
    await h.settle();
    expect(h.store.calls.upsertItem).toBe(1);
    expect(h.events["local-write"]).toHaveLength(1);
  });

  it("pushes edits without rewriting the user's file", async () => {
    await started();
    await addLocal("10_Notes/Idea.md", "v1\n");
    const id = h.store.itemByTitle("Idea")?.id as string;
    const edited = (await h.read("10_Notes/Idea.md")).replace("v1", "v2");
    await h.write("10_Notes/Idea.md", edited);
    await h.engine.handleLocalFile("10_Notes/Idea.md");
    await h.settle();
    expect(h.store.items.get(id)?.content_md).toBe("v2");
    expect(await h.read("10_Notes/Idea.md")).toBe(edited);
    expect(h.store.calls.upsertItem).toBe(2);
  });

  it("detects new sub-folders: folder rows with parents + is_manual_placement", async () => {
    await started();
    await addLocal("10_Notes/Automotive/Mercedes-AMG/W213.md", "AMG notes\n");
    const parent = h.store.folderByPath("10_Notes/Automotive");
    const child = h.store.folderByPath("10_Notes/Automotive/Mercedes-AMG");
    expect(parent).toMatchObject({
      name: "Automotive",
      slug: "automotive",
      parent_id: h.store.folderByPath("10_Notes")?.id,
    });
    expect(child).toMatchObject({
      name: "Mercedes-AMG",
      slug: "mercedes-amg",
      parent_id: parent?.id,
    });
    expect(h.store.itemByTitle("W213")).toMatchObject({
      folder_path: "10_Notes/Automotive/Mercedes-AMG",
      folder_id: child?.id,
      is_manual_placement: true,
    });
  });

  it("creates folder rows for empty directories the user adds", async () => {
    await started();
    await mkdir(h.abs("30_Clippings/Cars"), { recursive: true });
    await h.engine.handleLocalDirAdded("30_Clippings/Cars");
    await h.settle();
    expect(h.store.folderByPath("30_Clippings/Cars")).toBeDefined();
  });

  it("leaves inbox captures to the AI organizer (no manual placement)", async () => {
    await started();
    await addLocal("00_Inbox/quick.md", "capture\n");
    expect(h.store.itemByTitle("quick")?.is_manual_placement).toBe(false);
  });

  it("infers the domain object type from 70_Objects/<Type>/", async () => {
    await started();
    await addLocal(
      "70_Objects/Projects/Kortex.md",
      note("Second brain", { project_status: "active" }),
    );
    expect(h.store.itemByTitle("Kortex")).toMatchObject({
      type: "project",
      folder_path: "70_Objects/Projects",
    });
  });

  it("handles a move into another folder as a move (not delete + create)", async () => {
    await started();
    await addLocal("00_Inbox/trip.md", "Plan\n");
    const id = h.store.itemByTitle("trip")?.id as string;
    await mkdir(h.abs("10_Notes/Travel"), { recursive: true });
    await rename(h.abs("00_Inbox/trip.md"), h.abs("10_Notes/Travel/trip.md"));
    h.engine.handleLocalUnlink("00_Inbox/trip.md");
    await h.engine.handleLocalFile("10_Notes/Travel/trip.md");
    await h.settle();
    expect(h.store.items.get(id)).toMatchObject({
      folder_path: "10_Notes/Travel",
      is_manual_placement: true,
      status: "inbox",
    });
    expect(h.store.calls.archiveItem).toBe(0);
    expect(h.store.items.size).toBe(1);
    // The frontmatter folder_path is corrected after a move.
    expect((await h.readData("10_Notes/Travel/trip.md")).folder_path).toBe("10_Notes/Travel");
  });

  it("handles a rename as a slug change, keeping a manual edit flag untouched", async () => {
    await started();
    await addLocal("10_Notes/draft.md", "x\n");
    const id = h.store.itemByTitle("draft")?.id as string;
    await rename(h.abs("10_Notes/draft.md"), h.abs("10_Notes/final.md"));
    h.engine.handleLocalUnlink("10_Notes/draft.md");
    await h.engine.handleLocalFile("10_Notes/final.md");
    await h.settle();
    expect(h.store.items.get(id)).toMatchObject({
      slug: "final",
      folder_path: "10_Notes",
      is_manual_placement: true,
    });
    expect(h.store.items.size).toBe(1);
  });

  it("treats a copied file as a new item with a new id", async () => {
    await started();
    await addLocal("10_Notes/a.md", "x\n");
    await copyFile(h.abs("10_Notes/a.md"), h.abs("10_Notes/a copy.md"));
    await h.engine.handleLocalFile("10_Notes/a copy.md");
    await h.settle();
    expect(h.store.items.size).toBe(2);
    const ids = new Set([
      (await h.readData("10_Notes/a.md")).id,
      (await h.readData("10_Notes/a copy.md")).id,
    ]);
    expect(ids.size).toBe(2);
  });

  it("propagates a deletion (archive by default) after the grace period", async () => {
    await started();
    await addLocal("10_Notes/gone.md", "x\n");
    const id = h.store.itemByTitle("gone")?.id as string;
    await rm(h.abs("10_Notes/gone.md"));
    h.engine.handleLocalUnlink("10_Notes/gone.md");
    await h.settle();
    expect(h.store.items.get(id)?.status).toBe("archived");
    expect(h.events["remote-removed"]).toEqual([{ id, path: "10_Notes/gone.md", mode: "archive" }]);
    // The archive echo must not bring the file back.
    expect(await exists(h.abs("10_Notes/gone.md"))).toBe(false);
  });

  it("hard-deletes when localDeleteMode is 'delete'", async () => {
    await started({ localDeleteMode: "delete" });
    await addLocal("10_Notes/gone.md", "x\n");
    const id = h.store.itemByTitle("gone")?.id as string;
    await rm(h.abs("10_Notes/gone.md"));
    h.engine.handleLocalUnlink("10_Notes/gone.md");
    await h.settle();
    expect(h.store.items.has(id)).toBe(false);
  });

  it("holds back mass deletions", async () => {
    await started({ massDeleteThreshold: 2 });
    for (const n of ["a", "b", "c"]) await addLocal(`10_Notes/${n}.md`, `${n}\n`);
    for (const n of ["a", "b", "c"]) {
      await rm(h.abs(`10_Notes/${n}.md`));
      h.engine.handleLocalUnlink(`10_Notes/${n}.md`);
    }
    await h.settle();
    expect(h.store.calls.archiveItem).toBe(0);
    expect(
      h.events["sync-error"].some((e) => /mass delete/.test(String((e.error as Error).message))),
    ).toBe(true);
  });

  it("deletes the folder row when the user removes a sub-folder", async () => {
    await started();
    await addLocal("10_Notes/Old/x.md", "x\n");
    await rm(h.abs("10_Notes/Old"), { recursive: true });
    h.engine.handleLocalUnlink("10_Notes/Old/x.md");
    h.engine.handleLocalDirRemoved("10_Notes/Old");
    // System folders are never deleted remotely.
    h.engine.handleLocalDirRemoved("50_Recipes");
    await h.settle();
    expect(h.store.folderByPath("10_Notes/Old")).toBeUndefined();
    expect(h.store.folderByPath("50_Recipes")).toBeDefined();
    expect(h.store.itemByTitle("x")?.status).toBe("archived");
  });

  it("moves files at the vault root into the inbox", async () => {
    await started();
    await addLocal("Untitled.md", "root note\n");
    expect(await exists(h.abs("Untitled.md"))).toBe(false);
    expect(h.store.itemByTitle("Untitled")).toMatchObject({ folder_path: "00_Inbox" });
    expect((await h.readData("00_Inbox/Untitled.md")).id).toBe(h.store.itemByTitle("Untitled")?.id);
  });

  it("skips files with broken YAML and never overwrites them", async () => {
    await started();
    const broken = "---\ntitle: [oops\n---\nbody\n";
    await addLocal("10_Notes/broken.md", broken);
    expect(h.store.calls.upsertItem).toBe(0);
    expect(await h.read("10_Notes/broken.md")).toBe(broken);
    expect(h.events["sync-error"]).toHaveLength(1);
  });

  it("flags new 40_AI_Memories files for the ingest pipeline (once)", async () => {
    const seen: string[] = [];
    h = await createHarness({ onAiMemory: (e) => void seen.push(e.id) });
    await h.engine.start();
    await addLocal("40_AI_Memories/claude-session.md", "## Decisions\n- ship md-sync\n");
    const item = h.store.itemByTitle("claude-session");
    expect(item).toMatchObject({ type: "ai_chat", status: "inbox", folder_path: "40_AI_Memories" });
    expect(h.events["ai-memory"]).toEqual([
      {
        id: item?.id,
        path: "40_AI_Memories/claude-session.md",
        title: "claude-session",
        folderPath: "40_AI_Memories",
      },
    ]);
    expect(seen).toEqual([item?.id]);
    // Edits and remote-created memories don't re-trigger it.
    await h.write(
      "40_AI_Memories/claude-session.md",
      (await h.read("40_AI_Memories/claude-session.md")) + "more\n",
    );
    await h.engine.handleLocalFile("40_AI_Memories/claude-session.md");
    h.store.seedItem({ title: "From web", folder_path: "40_AI_Memories", type: "ai_chat" });
    await h.settle();
    expect(h.events["ai-memory"]).toHaveLength(1);
  });
});

describe("conflicts", () => {
  async function syncedItem() {
    await started();
    const item = h.store.seedItem({
      title: "Doc",
      slug: "doc",
      folder_path: "10_Notes",
      content_md: "base",
    });
    await h.settle();
    return item;
  }

  it("remote newer: remote wins, local version saved as <slug>.conflict-<ts>.md", async () => {
    const item = await syncedItem();
    await h.engine.stop();
    const localText = (await h.read("10_Notes/doc.md")).replace("base", "local edit");
    await h.write("10_Notes/doc.md", localText, new Date(Date.now() - 60_000));
    h.store.editItem(item.id, { content_md: "remote edit" });
    await h.restart();

    expect(parseMarkdown(await h.read("10_Notes/doc.md")).body).toBe("remote edit");
    const files = await readdir(h.abs("10_Notes"));
    const conflict = files.find((f) => /^doc\.conflict-\d{8}T\d{6}Z\.md$/.test(f));
    expect(conflict).toBeDefined();
    expect(await h.read(`10_Notes/${conflict}`)).toBe(localText);
    expect(h.events.conflict).toMatchObject([
      { id: item.id, winner: "remote", path: "10_Notes/doc.md" },
    ]);
    expect(h.store.items.get(item.id)?.content_md).toBe("remote edit");
  });

  it("local newer: local wins remotely, remote version saved as conflict copy", async () => {
    const item = await syncedItem();
    await h.engine.stop();
    h.store.editItem(item.id, { content_md: "remote edit" });
    const localText = (await h.read("10_Notes/doc.md")).replace("base", "local edit");
    await h.write("10_Notes/doc.md", localText, new Date(Date.now() + 60_000));
    await h.restart();

    expect(h.store.items.get(item.id)?.content_md).toBe("local edit");
    expect(await h.read("10_Notes/doc.md")).toBe(localText);
    const conflict = (await readdir(h.abs("10_Notes"))).find((f) =>
      f.includes(".conflict-"),
    ) as string;
    expect(parseMarkdown(await h.read(`10_Notes/${conflict}`)).body).toBe("remote edit");
    expect(h.events.conflict).toMatchObject([{ id: item.id, winner: "local" }]);
  });

  it("detects a live conflict when a remote change meets an unpushed local edit", async () => {
    const item = await syncedItem();
    // User edits (watcher event not processed yet), then the web app saves too.
    await h.write(
      "10_Notes/doc.md",
      (await h.read("10_Notes/doc.md")).replace("base", "mine"),
      new Date(Date.now() - 60_000),
    );
    h.store.editItem(item.id, { content_md: "theirs" });
    await h.settle();
    expect(h.events.conflict).toHaveLength(1);
    expect(parseMarkdown(await h.read("10_Notes/doc.md")).body).toBe("theirs");
    // Conflict copies are local-only.
    expect(h.store.items.size).toBe(1);
  });
});

describe("reconcile", () => {
  it("catches up on offline changes on both sides", async () => {
    await started();
    await addLocal("10_Notes/keep.md", "keep\n");
    await addLocal("10_Notes/edit.md", "v1\n");
    await addLocal("10_Notes/delete-me.md", "bye\n");
    await h.engine.stop();

    await h.write("10_Notes/edit.md", (await h.read("10_Notes/edit.md")).replace("v1", "v2"));
    await rm(h.abs("10_Notes/delete-me.md"));
    await writeFile(h.abs("10_Notes/new-offline.md"), "fresh\n");
    const remoteNew = h.store.seedItem({
      title: "From phone",
      folder_path: "00_Inbox",
      content_md: "hi",
    });
    await h.restart();

    expect(h.store.itemByTitle("edit")?.content_md).toBe("v2");
    expect(h.store.itemByTitle("delete-me")?.status).toBe("archived");
    expect(h.store.itemByTitle("new-offline")).toBeDefined();
    expect(parseMarkdown(await h.read("00_Inbox/from-phone.md")).data.id).toBe(remoteNew.id);
    expect(h.events.conflict).toHaveLength(0);
  });

  it("is a no-op when nothing changed (restart does not rewrite or re-push)", async () => {
    await started();
    await addLocal("10_Notes/a.md", "a\n");
    h.store.seedItem({ title: "B", folder_path: "10_Notes", content_md: "b" });
    await h.settle();
    const upserts = h.store.calls.upsertItem;
    await h.restart();
    expect(h.store.calls.upsertItem).toBe(upserts);
    expect(h.events["local-write"]).toHaveLength(0);
    expect(h.events.reconciled[0]).toMatchObject({ pulled: 0, pushed: 0, conflicts: 0, errors: 0 });
  });

  it("re-adopts an already synced vault when the state file is lost", async () => {
    await started();
    await addLocal("10_Notes/a.md", "a\n");
    h.store.seedItem({ title: "B", folder_path: "10_Notes", content_md: "b" });
    await h.settle();
    await h.engine.stop();
    await rm(h.abs(".kortex/state.json"));
    const upserts = h.store.calls.upsertItem;
    await h.restart();
    expect(h.store.calls.upsertItem).toBe(upserts);
    expect(h.events["local-write"]).toHaveLength(0);
    expect(h.events.conflict).toHaveLength(0);
  });

  it("reconciles after a Realtime reconnect", async () => {
    await started();
    h.store.setStatus("disconnected", "CHANNEL_ERROR");
    // A change made while the channel was down: Realtime never delivers it.
    const now = new Date().toISOString();
    const template = h.store.seedItem({ title: "Template", folder_path: "10_Notes" });
    await h.settle();
    const missedId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    h.store.items.set(missedId, {
      ...template,
      id: missedId,
      title: "Missed",
      slug: "missed",
      created_at: now,
      updated_at: now,
    });
    await h.settle();
    expect(await exists(h.abs("10_Notes/missed.md"))).toBe(false);

    const before = h.events.reconciled.length;
    h.store.setStatus("connected");
    await h.settle();
    expect(h.events.reconciled.length).toBe(before + 1);
    expect((await h.readData("10_Notes/missed.md")).id).toBe(missedId);
    expect(h.events["remote-status"].map((s) => s.status)).toContain("disconnected");
  });

  it("holds back a mass wipe of the vault", async () => {
    await started({ massDeleteThreshold: 2 });
    for (const n of ["a", "b", "c", "d"]) await addLocal(`10_Notes/${n}.md`, `${n}\n`);
    await h.engine.stop();
    for (const n of ["a", "b", "c", "d"]) await rm(h.abs(`10_Notes/${n}.md`));
    await h.restart({ massDeleteThreshold: 2 });
    expect(h.store.calls.archiveItem).toBe(0);
    expect(h.events["sync-error"].length).toBeGreaterThan(0);
  });
});

describe("state file", () => {
  it("lives in .kortex/ and is ignored by the sync", async () => {
    await started();
    await addLocal("10_Notes/a.md", "a\n");
    await h.engine.stop();
    const state = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(path.join(h.vault, ".kortex", "state.json"), "utf8"),
    );
    expect(Object.values(state.items)).toMatchObject([{ path: "10_Notes/a.md" }]);
  });
});
