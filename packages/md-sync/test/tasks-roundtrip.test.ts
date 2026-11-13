import { afterEach, describe, expect, it } from "vitest";
import { parseTaskSection } from "@kortex/db";
import { parseMarkdown } from "../src/frontmatter";
import { createHarness, type Harness } from "./helpers";

// Portable Markdown: Aufgaben einer Quelle stehen als "## Aufgaben"-Abschnitt in der Vault-Datei.
// Änderungen in der App kommen in die Datei, Häkchen/Edits/neue Zeilen in der Datei zurück in die
// action_items, ohne Schleife und ohne Duplikate.

let h: Harness;
afterEach(async () => {
  await h?.cleanup();
});

const REL = "10_Notes/sync-montag.md";

async function setup() {
  h = await createHarness();
  await h.engine.start();
  await h.settle();
  const item = h.store.seedItem({
    title: "Sync Montag",
    slug: "sync-montag",
    folder_path: "10_Notes",
    content_md: "# Sync Montag\n\nNotizen.",
  });
  await h.settle();
  return item;
}

const tasksOf = (itemId: string) => h.store.actionItems.filter((a) => a.source_item_id === itemId);

describe("tasks markdown roundtrip", () => {
  it("app -> vault: a new or edited task re-renders the section, the note text stays", async () => {
    const item = await setup();
    const id = h.store.seedTask({ source_item_id: item.id, title: "Folien senden", timeframe: "this_week" });
    await h.settle();
    let body = parseMarkdown(await h.read(REL)).body;
    expect(body).toContain("# Sync Montag\n\nNotizen.\n\n## Aufgaben\n\n");
    expect(body).toContain(`- [ ] Folien senden · Zeitrahmen: diese Woche <!-- task:${id} -->`);

    h.store.editTask(id, { status: "done", context: "aus dem Meeting" });
    await h.settle();
    body = parseMarkdown(await h.read(REL)).body;
    expect(body).toContain(
      `- [x] Folien senden · Zeitrahmen: diese Woche · Kontext: aus dem Meeting <!-- task:${id} -->`,
    );

    h.store.removeTask(id);
    await h.settle();
    body = parseMarkdown(await h.read(REL)).body;
    expect(body).not.toContain("Folien senden");
    expect(body.startsWith("# Sync Montag\n\nNotizen.")).toBe(true);
  });

  it("vault -> app: ticked box, edited text and a new line update the tasks without a loop", async () => {
    const item = await setup();
    const id = h.store.seedTask({ source_item_id: item.id, title: "Folien senden" });
    await h.settle();
    const pushesBefore = h.store.calls.upsertItem;

    const edited = (await h.read(REL))
      .replace("- [ ] Folien senden", "- [x] Folien an das Team senden · Fällig: 2026-11-05")
      .trimEnd()
      .concat("\n- [ ] Raum buchen · Zeitrahmen: heute\n");
    await h.write(REL, edited);
    await h.engine.handleLocalFile(REL);
    await h.settle();

    const tasks = tasksOf(item.id);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.id === id)).toMatchObject({
      title: "Folien an das Team senden",
      status: "done",
      due_date: "2026-11-05T00:00:00Z",
    });
    const added = tasks.find((t) => t.id !== id);
    expect(added).toMatchObject({ title: "Raum buchen", timeframe: "today", status: "open" });

    // The new line got its id marker in the file; the ticked line stayed as typed (fixed point).
    const body = parseMarkdown(await h.read(REL)).body;
    expect(body).toContain(`- [ ] Raum buchen · Zeitrahmen: heute <!-- task:${added!.id} -->`);
    expect(parseTaskSection(body)?.map((l) => l.id)).toEqual([id, added!.id]);

    // Exactly one push (the user's edit); the re-render came back as a pull, not another push.
    expect(h.store.calls.upsertItem).toBe(pushesBefore + 1);
    const refreshes = h.store.calls.refreshTaskSection;
    await h.engine.reconcile();
    await h.settle();
    expect(h.store.calls.upsertItem).toBe(pushesBefore + 1);
    expect(h.store.calls.refreshTaskSection).toBe(refreshes);
  });

  it("re-syncing the same file creates no duplicate and does not revive a deleted task", async () => {
    const item = await setup();
    const id = h.store.seedTask({ source_item_id: item.id, title: "Folien senden" });
    await h.settle();
    const withLine = (await h.read(REL)).trimEnd().concat("\n- [ ] Raum buchen\n");
    await h.write(REL, withLine);
    await h.engine.handleLocalFile(REL);
    await h.settle();
    expect(tasksOf(item.id)).toHaveLength(2);

    // A stale copy of the file (without the new marker, with the old task's marker) comes back.
    h.store.removeTask(id);
    await h.settle();
    await h.write(REL, withLine.replace("Notizen.", "Notizen, später ergänzt."));
    await h.engine.handleLocalFile(REL);
    await h.settle();
    const titles = tasksOf(item.id).map((t) => t.title);
    expect(titles).toEqual(["Raum buchen"]);
  });
});
