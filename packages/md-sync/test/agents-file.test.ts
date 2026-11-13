import { stat } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTS_FILE_NAME, FRONTMATTER_GUIDE } from "@kortex/mcp-server/agents-guide";
import { scanFolderCounts, VaultAgentsFile } from "../src/agents-file";
import { FRONTMATTER_KEYS } from "../src/frontmatter";
import { isIgnoredRel, VAULT_AGENTS_FILE } from "../src/paths";
import { createHarness, note, type Harness } from "./helpers";

describe("vault agents.md", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
    await h.engine.start();
    await h.settle();
  });
  afterEach(() => h.cleanup());

  it("uses the shared file name and frontmatter keys", () => {
    expect(VAULT_AGENTS_FILE).toBe(AGENTS_FILE_NAME);
    expect(FRONTMATTER_GUIDE.map((k) => k.key)).toEqual([...FRONTMATTER_KEYS]);
  });

  it("is ignored by the sync (root only)", async () => {
    expect(isIgnoredRel("agents.md")).toBe(true);
    expect(isIgnoredRel("AGENTS.md")).toBe(
      process.platform === "win32" || process.platform === "darwin",
    );
    expect(isIgnoredRel("10_Notes/agents.md")).toBe(false);

    const file = await new VaultAgentsFile({ engine: h.engine, debounceMs: 10 }).start();
    await h.engine.reconcile();
    await h.settle();
    expect(h.store.items.size).toBe(0); // not pushed, not moved to 00_Inbox
    expect(await h.read("agents.md")).toContain("# Kortex agents guide");
    await file.stop();
  });

  it("counts markdown files per folder", async () => {
    await h.write("10_Notes/Work/a.md", note("A"));
    await h.write("10_Notes/Work/b.md", note("B"));
    await h.write("00_Inbox/c.md", note("C"));
    const counts = Object.fromEntries(
      (await scanFolderCounts(h.vault)).map((c) => [c.folder_path, c.items]),
    );
    expect(counts["10_Notes/Work"]).toBe(2);
    expect(counts["00_Inbox"]).toBe(1);
    expect(counts["70_Objects/People"]).toBe(0);
    expect(counts[".kortex"]).toBeUndefined();
  });

  it("writes on start, rewrites after sync activity, and only when changed", async () => {
    const file = await new VaultAgentsFile({ engine: h.engine, debounceMs: 20 }).start();
    const first = await h.read("agents.md");
    expect(first).toContain("## Folder index (this vault)");
    expect(first).not.toContain("`Projects-X/`");
    const mtime = (await stat(h.abs("agents.md"))).mtimeMs;

    expect(await file.refresh()).toBe(false); // unchanged: no write
    expect((await stat(h.abs("agents.md"))).mtimeMs).toBe(mtime);

    await h.write("10_Notes/Projects-X/plan.md", note("Plan"));
    await h.engine.reconcile();
    await h.settle();
    // debounced rewrite: poll instead of a fixed sleep (slow under parallel load)
    await vi.waitFor(async () => expect(await h.read("agents.md")).toContain("- `Projects-X/` 1"), {
      timeout: 10_000,
      interval: 50,
    });
    await file.stop();
  });
});
