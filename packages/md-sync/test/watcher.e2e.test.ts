import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "../src/frontmatter";
import { exists } from "../src/fs-utils";
import { createHarness, sleep, type Harness } from "./helpers";

// Real chokidar + awaitWriteFinish (400 ms) on a temp vault. Slower, so one shared engine.
describe("live sync through the real file watcher", () => {
  let h: Harness;
  const wait = { timeout: 10_000, interval: 50 };

  beforeAll(async () => {
    h = await createHarness({ watch: true, deleteGraceMs: 1200 });
    await h.engine.start();
  });
  afterAll(async () => {
    await h.cleanup();
  });

  it("pushes a new file once and the id write-back does not loop", async () => {
    await writeFile(h.abs("10_Notes/live.md"), "hello from the editor\n");
    await vi.waitFor(() => expect(h.store.itemByTitle("live")).toBeDefined(), wait);
    await vi.waitFor(
      async () => expect((await h.readData("10_Notes/live.md")).id).toBeTruthy(),
      wait,
    );
    await sleep(1500); // longer than awaitWriteFinish + Realtime echo
    await h.engine.idle();
    expect(h.store.calls.upsertItem).toBe(1);
    expect(h.events["local-write"]).toHaveLength(1);
    // Atomic writes leave no temp files behind.
    expect((await readdir(h.abs("10_Notes"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("pushes edits", async () => {
    const text = await h.read("10_Notes/live.md");
    await writeFile(h.abs("10_Notes/live.md"), text.replace("hello", "edited"));
    await vi.waitFor(
      () => expect(h.store.itemByTitle("live")?.content_md).toBe("edited from the editor"),
      wait,
    );
    expect(h.store.calls.upsertItem).toBe(2);
  });

  it("pulls remote edits without echoing them back", async () => {
    const id = h.store.itemByTitle("live")?.id as string;
    const upserts = h.store.calls.upsertItem;
    h.store.editItem(id, { content_md: "edited in the web app" });
    await vi.waitFor(
      async () =>
        expect(parseMarkdown(await h.read("10_Notes/live.md")).body).toBe("edited in the web app"),
      wait,
    );
    await sleep(1500);
    await h.engine.idle();
    expect(h.store.calls.upsertItem).toBe(upserts);
  });

  it("detects a move into a new sub-folder", async () => {
    const id = h.store.itemByTitle("live")?.id as string;
    await mkdir(h.abs("10_Notes/Projects/Kortex"), { recursive: true });
    await rename(h.abs("10_Notes/live.md"), h.abs("10_Notes/Projects/Kortex/live.md"));
    await vi.waitFor(
      () => expect(h.store.items.get(id)?.folder_path).toBe("10_Notes/Projects/Kortex"),
      wait,
    );
    await sleep(1500); // past the delete grace period
    await h.engine.idle();
    expect(h.store.items.get(id)).toMatchObject({ status: "inbox", is_manual_placement: true });
    expect(h.store.folderByPath("10_Notes/Projects/Kortex")).toBeDefined();
    expect(h.store.calls.archiveItem).toBe(0);
  });

  it("propagates a delete after the grace period", async () => {
    const id = h.store.itemByTitle("live")?.id as string;
    await rm(h.abs("10_Notes/Projects/Kortex/live.md"));
    await vi.waitFor(() => expect(h.store.items.get(id)?.status).toBe("archived"), wait);
    await sleep(500);
    expect(await exists(h.abs("10_Notes/Projects/Kortex/live.md"))).toBe(false);
  });
});
