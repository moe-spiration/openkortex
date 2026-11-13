import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./helpers";

// On Windows a folder deleted while a watcher (chokidar, Explorer, an editor) still holds it stays
// "delete pending": mkdir/readdir/stat on it fail with EPERM until the handle closes. Live, that
// made every full reconcile fail for good (e8-live hand-over). These tests inject that EPERM for
// chosen folders through node:fs/promises.
const { poisoned } = vi.hoisted(() => ({ poisoned: new Set<string>() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const nodePath = await import("node:path");
  const guard = (p: unknown) => {
    const key = nodePath.resolve(String(p)).toLowerCase();
    for (const bad of poisoned) {
      if (key === bad || key.startsWith(bad + nodePath.sep)) {
        throw Object.assign(new Error(`EPERM: operation not permitted, '${String(p)}'`), {
          code: "EPERM",
        });
      }
    }
  };
  const wrap =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      guard(args[0]);
      return fn(...args);
    };
  return {
    ...actual,
    mkdir: wrap(actual.mkdir),
    readdir: wrap(actual.readdir),
    stat: wrap(actual.stat),
  };
});

let h: Harness;
afterEach(async () => {
  poisoned.clear();
  await h?.cleanup();
});

const poison = (rel: string) => poisoned.add(path.resolve(h.abs(rel)).toLowerCase());

async function started() {
  h = await createHarness();
  await h.engine.start();
  await h.settle();
}

const folderErrors = () =>
  h.events["sync-error"]
    .filter((e) => e.context === "folder not accessible, skipped")
    .map((e) => e.path);

describe("reconcile survives folders it can't touch (EPERM)", () => {
  it("a default folder that can't be created is skipped, the rest still syncs", async () => {
    await started();
    poison("50_Recipes");
    h.store.seedItem({ title: "Still pulled", folder_path: "10_Notes", content_md: "x" });
    const stats = await h.engine.reconcile();
    expect(stats.pulled).toBe(1);
    expect(stats.errors).toBeGreaterThanOrEqual(1);
    expect(folderErrors()).toContain("50_Recipes");
    expect(h.events["sync-error"].some((e) => e.context === "reconcile")).toBe(false);
  });

  it("a remote folder whose directory can't be created is skipped", async () => {
    await started();
    h.store.seedFolder("10_Notes/Locked", h.store.folderByPath("10_Notes")?.id ?? null);
    poison("10_Notes/Locked");
    h.store.seedItem({ title: "Other note", folder_path: "10_Notes", content_md: "y" });
    await h.settle();
    const stats = await h.engine.reconcile();
    expect(folderErrors()).toContain("10_Notes/Locked");
    expect(h.events["sync-error"].some((e) => e.context === "reconcile")).toBe(false);
    expect(stats.unchanged + stats.pulled).toBeGreaterThanOrEqual(1);
    expect((await h.readData("10_Notes/other-note.md")).title).toBe("Other note");
  });

  it("an unreadable sub-folder is skipped and its notes are not treated as deleted", async () => {
    await started();
    await h.write("10_Notes/Proj/a.md", "inside\n");
    await h.engine.handleLocalFile("10_Notes/Proj/a.md");
    await h.settle();
    const tracked = h.store.itemByTitle("a");
    expect(tracked).toBeDefined();

    poison("10_Notes/Proj");
    await h.write("10_Notes/b.md", "outside\n");
    const stats = await h.engine.reconcile();
    expect(folderErrors()).toContain("10_Notes/Proj");
    expect(h.store.itemByTitle("b")).toBeDefined(); // the rest of the vault still syncs
    expect(stats.removedRemote).toBe(0);
    expect(h.store.calls.archiveItem).toBe(0);
    expect(h.store.items.get(tracked!.id)?.status).toBe("inbox");
  });

  it("a deletion that can't be confirmed (stat fails) is not propagated", async () => {
    await started();
    await h.write("10_Notes/Proj/a.md", "inside\n");
    await h.engine.handleLocalFile("10_Notes/Proj/a.md");
    await h.settle();
    poison("10_Notes/Proj");
    h.engine.handleLocalUnlink("10_Notes/Proj/a.md");
    await h.settle();
    expect(h.store.calls.archiveItem).toBe(0);
    expect(folderErrors()).toContain("10_Notes/Proj/a.md");
  });
});
