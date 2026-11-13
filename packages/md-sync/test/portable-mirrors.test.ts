import { afterEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/frontmatter";
import { createHarness, type Harness } from "./helpers";

// Portable Markdown: Clipper sessions, the Scratchpad archive and the Focus profile are ordinary
// knowledge items; each must land as .md with YAML frontmatter in its vault folder and survive a vault edit.

let h: Harness;
afterEach(async () => {
  await h?.cleanup();
});

const tabs = [
  { url: "https://example.com/a", title: "A" },
  { url: "https://example.com/b" },
];

describe("portable mirrors", () => {
  it("session: cloud -> 30_Clippings/Sessions/*.md with tabs in frontmatter -> edit -> cloud", async () => {
    h = await createHarness();
    await h.engine.start();
    await h.settle();
    const item = h.store.seedItem({
      title: "3 Tabs",
      slug: "3-tabs",
      type: "session",
      folder_path: "30_Clippings/Sessions",
      content_md: "# 3 Tabs\n\n- [A](<https://example.com/a>)\n- [example.com](<https://example.com/b>)\n",
      metadata: { saved_at: "2026-11-01T10:00:00.000Z", tabs },
    });
    await h.settle();
    const rel = "30_Clippings/Sessions/3-tabs.md";
    const data = await h.readData(rel);
    expect(data).toMatchObject({ id: item.id, type: "session", metadata: { tabs } });

    await h.write(rel, (await h.read(rel)).replace("- [A](<https://example.com/a>)", "- [A2](<https://example.com/a>)"));
    await h.engine.handleLocalFile(rel);
    await h.settle();
    const stored = await h.store.getItem(item.id);
    expect(stored?.content_md).toContain("[A2]");
    expect(stored?.type).toBe("session");
    expect(stored?.metadata).toMatchObject({ tabs });
  });

  it("scratchpad archive: 10_Notes/Scratchpad-Archiv.md keeps the bullet entries", async () => {
    h = await createHarness();
    await h.engine.start();
    await h.settle();
    const md = "# Scratchpad-Archiv\n\nAufgeräumte Scratchpad-Einträge.\n\n- 2026-10-31 09:00 · eins\n  zwei\n- 2026-10-31 09:05 · drei\n";
    h.store.seedItem({
      title: "Scratchpad-Archiv",
      slug: "scratchpad-archiv",
      folder_path: "10_Notes",
      content_md: md,
      metadata: { scratchpad_archive: true },
    });
    await h.settle();
    const file = await h.read("10_Notes/scratchpad-archiv.md");
    expect(parseMarkdown(file).body).toBe(md.trim());
    expect(await h.readData("10_Notes/scratchpad-archiv.md")).toMatchObject({
      metadata: { scratchpad_archive: true },
    });
  });

  it("focus profile: 40_AI_Memories/Focus-Profile.md keeps metadata and the user's own notes after an edit", async () => {
    h = await createHarness();
    await h.engine.start();
    await h.settle();
    const body = "# Fokus-Profil\n\n## Aktuelle Fokus-Themen\n\n- RAG\n\n## Eigene Notizen\n\nmeine Ziele\n";
    const item = h.store.seedItem({
      title: "Fokus-Profil",
      slug: "Focus-Profile",
      folder_path: "40_AI_Memories",
      content_md: body,
      tags: ["ai/focus-profile"],
      metadata: { kind: "focus_profile", focus_topics: ["RAG"], projects: [], interests: [] },
    });
    await h.settle();
    const rel = "40_AI_Memories/Focus-Profile.md";
    expect(await h.readData(rel)).toMatchObject({
      id: item.id,
      tags: ["ai/focus-profile"],
      metadata: { kind: "focus_profile", focus_topics: ["RAG"] },
    });
    await h.write(rel, (await h.read(rel)).replace("meine Ziele", "meine neuen Ziele"));
    await h.engine.handleLocalFile(rel);
    await h.settle();
    const stored = await h.store.getItem(item.id);
    expect(stored?.content_md).toContain("meine neuen Ziele");
    expect(stored?.metadata).toMatchObject({ kind: "focus_profile" });
  });
});
