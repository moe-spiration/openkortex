import { TYPE_REGISTRY, type KortexClient } from "@kortex/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SupabaseBrainRepository } from "../src/supabase-repository";
import { defaultFolder } from "../src/tools";
import { connect } from "./helpers";

// Audit 0.6.1 M-15: without folder_path a new item goes to its type's home folder from the type
// registry (book -> 60_Documents/Books), generic types to the Inbox. M-17: the Supabase repository
// stores folder_id next to folder_path on create and on every move.

describe("defaultFolder (type registry)", () => {
  it("sends types with a home folder there and generic types to the Inbox", () => {
    expect(defaultFolder("book")).toBe("60_Documents/Books");
    expect(defaultFolder("movie")).toBe("30_Clippings/Movies");
    expect(defaultFolder("recipe")).toBe("50_Recipes");
    expect(defaultFolder("person")).toBe("70_Objects/People");
    expect(defaultFolder("daily_note")).toBe("10_Notes/Daily");
    expect(defaultFolder("ai_chat")).toBe("40_AI_Memories");
    expect(defaultFolder("note")).toBe("00_Inbox");
    expect(defaultFolder("article")).toBe("00_Inbox");
  });

  it("follows the registry for every type", () => {
    for (const [type, def] of Object.entries(TYPE_REGISTRY))
      expect(defaultFolder(type as keyof typeof TYPE_REGISTRY), type).toBe(def.inferFromFolder ? def.folder : "00_Inbox");
  });
});

describe("brain_save_item without folder_path", () => {
  let t: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    t = await connect();
  });
  afterEach(() => t.close());

  it("files a book in 60_Documents/Books, not manually placed", async () => {
    const { json } = await t.call("brain_save_item", { title: "Dune", type: "book", content_md: "Sci-Fi." });
    expect(json.folder_path).toBe("60_Documents/Books");
    const item = (await t.call("brain_get_item", { id: json.id })).json.item;
    expect(item.is_manual_placement).toBe(false);
  });
});

// Minimal supabase-js stand-in for folders and knowledge_items (select/insert/update + eq/like/maybeSingle/single).
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>) {
  let seq = 0;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let insert: Row | null = null;
    let update: Row | null = null;
    let one = false;
    const q = {
      select: () => q,
      insert: (r: Row) => ((insert = r), q),
      update: (r: Row) => ((update = r), q),
      upsert: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      like: (c: string, v: string) => (filters.push((r) => String(r[c] ?? "").startsWith(v.replace(/%$/, ""))), q),
      order: () => q,
      limit: () => q,
      single: () => ((one = true), q),
      maybeSingle: () => ((one = true), q),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        if (insert) {
          const row = { id: `${table}-${++seq}`, created_at: "2026-11-03T00:00:00Z", updated_at: "2026-11-03T00:00:00Z", ...insert };
          rows.push(row);
          return Promise.resolve(resolve({ data: row, error: null }));
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (update) for (const r of hit) Object.assign(r, update);
        return Promise.resolve(resolve({ data: one ? (hit[0] ?? null) : hit, error: null }));
      },
    };
    return q;
  };
  return { from } as unknown as KortexClient;
}

describe("SupabaseBrainRepository folder_id", () => {
  it("sets folder_id on create and on a move", async () => {
    const folders: Row[] = [];
    const items: Row[] = [];
    const tables: Record<string, Row[]> = { folders, knowledge_items: items, tags: [] };
    const repo = new SupabaseBrainRepository({ client: fakeClient(tables), userId: "u1", userScoped: true });
    const item = await repo.createItem({
      type: "book",
      title: "Dune",
      slug: "dune",
      content_md: "",
      folder_path: "60_Documents/Books",
    });
    const books = folders.find((f) => f.folder_path === "60_Documents/Books");
    expect(books).toBeDefined();
    expect(items[0]?.folder_id).toBe(books?.id);

    await repo.updateItem(item.id, { folder_path: "Lesen/Sci-Fi", is_manual_placement: true });
    const target = folders.find((f) => f.folder_path === "Lesen/Sci-Fi");
    expect(target?.parent_id).toBe(folders.find((f) => f.folder_path === "Lesen")?.id);
    expect(items[0]?.folder_id).toBe(target?.id);
    expect(items[0]?.folder_path).toBe("Lesen/Sci-Fi");
  });
});
