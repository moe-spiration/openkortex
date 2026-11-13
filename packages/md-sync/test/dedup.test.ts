import { afterEach, describe, expect, it } from "vitest";
import { exists } from "../src/fs-utils";
import { createHarness, type Harness } from "./helpers";

// Pflicht-Test Dedup über md-sync: dieselbe URL / ISBN zweimal als neue Vault-Datei ergibt genau ein Item.

let h: Harness;
afterEach(async () => {
  await h?.cleanup();
});

async function addLocal(rel: string, text: string) {
  await h.write(rel, text);
  await h.engine.handleLocalFile(rel);
  await h.settle();
}

const items = () => [...(h.store as unknown as { items: Map<string, unknown> }).items.values()];

describe("md-sync dedup", () => {
  it("a second file with the same source URL is merged, not a second item", async () => {
    h = await createHarness();
    await h.engine.start();
    await h.settle();
    await addLocal(
      "30_Clippings/Artikel.md",
      "---\ntitle: Artikel\nsource_ref: https://www.example.com/a?utm_source=x\ntags: [ai]\n---\nErster Text\n",
    );
    const before = items().length;
    await addLocal(
      "30_Clippings/Artikel Kopie.md",
      "---\ntitle: Artikel Kopie\nsource_ref: https://example.com/a/\ntags: [lesen]\n---\nZweiter Text\n",
    );
    expect(items()).toHaveLength(before);
    const item = h.store.itemByTitle("Artikel");
    expect(item?.tags).toEqual(["ai", "lesen"]);
    expect(item?.content_md).toContain("Zweiter Text");
    expect(h.events.duplicate).toHaveLength(1);
    expect(await exists(h.abs("30_Clippings/Artikel Kopie.md"))).toBe(false);
    const kept = (h.events.duplicate[0] as { keptAs: string }).keptAs;
    expect(kept).toMatch(/Artikel Kopie\.conflict-.*\.md$/);
    expect(await exists(h.abs(kept))).toBe(true); // nothing deleted
  });

  it("a book with the same ISBN is one item", async () => {
    h = await createHarness();
    await h.engine.start();
    await h.settle();
    await addLocal(
      "60_Documents/Books/Dune.md",
      "---\ntitle: Dune\ntype: book\nmetadata:\n  isbn: 978-0441013593\n---\n",
    );
    const before = items().length;
    await addLocal(
      "60_Documents/Books/Dune (Herbert).md",
      "---\ntitle: Dune (Herbert)\ntype: book\nmetadata:\n  isbn: '9780441013593'\n  status: read\n---\n",
    );
    expect(items()).toHaveLength(before);
    expect(h.store.itemByTitle("Dune")?.metadata).toMatchObject({
      isbn: "978-0441013593",
      status: "read",
    });
  });
});
