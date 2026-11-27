import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isUnread, upsertSection } from "../src/reading";
import { connect } from "./helpers";

describe("upsertSection", () => {
  it("appends, then replaces only its own section", () => {
    const note = "# 2026-10-23\n\nMy own text.\n\n## Focus\n\n- write";
    const once = upsertSection(note, "Noema Brief", "First");
    expect(once).toBe("# 2026-10-23\n\nMy own text.\n\n## Focus\n\n- write\n\n## Noema Brief\n\nFirst\n");
    const twice = upsertSection(once, "noema brief", "Second\n\n### Detail");
    expect(twice).toContain("## Noema Brief\n\nSecond\n\n### Detail\n");
    expect(twice).not.toContain("First");
    expect(upsertSection(twice, "Noema Brief", "Second\n\n### Detail")).toBe(twice);
  });

  it("keeps the sections after it and ignores headings in code fences", () => {
    const note = "## Noema Brief\n\nold\n```\n## not a heading\n```\n\n## Journal\n\nmine";
    expect(upsertSection(note, "Noema Brief", "new")).toBe("## Noema Brief\n\nnew\n\n## Journal\n\nmine\n");
  });
});

describe("isUnread", () => {
  const at = "2026-10-23T09:30:00.000Z";
  it("hides read, skipped and snoozed items", () => {
    expect(isUnread({}, null, at)).toBe(true);
    expect(isUnread({ read_status: "unread" }, null, at)).toBe(true);
    expect(isUnread({ read_status: "read" }, null, at)).toBe(false);
    expect(isUnread({ read_status: "skipped" }, null, at)).toBe(false);
    expect(isUnread({}, "2026-11-01T00:00:00Z", at)).toBe(false);
    expect(isUnread({}, "2026-10-01T00:00:00Z", at)).toBe(true);
  });
});

describe("reading queue and daily-note sections over MCP", () => {
  let t: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    t = await connect();
  });
  afterEach(() => t.close());

  const save = async (args: Record<string, unknown>) => (await t.call("brain_save_item", args)).json;
  const queue = async (args: Record<string, unknown> = {}) =>
    (await t.call("brain_search", { unread: true, ...args })).json.results.map((r: { title: string }) => r.title);

  it("lists unread clippings and drops read, skipped and snoozed ones", async () => {
    const a = await save({ title: "Agents article", content_md: "agents", type: "article" });
    const b = await save({ title: "Podcast on MCP", content_md: "mcp", type: "podcast" });
    const c = await save({ title: "Video later", content_md: "later", type: "video" });
    await save({ title: "A plain note", content_md: "note" });
    expect((await queue()).sort()).toEqual(["Agents article", "Podcast on MCP", "Video later"]);

    const read = await t.call("brain_organize", { action: "set_read_status", item_id: a.id, read_status: "read" });
    expect(read.json.metadata).toMatchObject({ read_status: "read", read_at: "2026-10-23T09:30:00.000Z" });
    await t.call("brain_organize", { action: "set_read_status", item_id: b.id, read_status: "skipped" });
    await t.call("brain_organize", { action: "snooze", item_id: c.id, date: "2026-11-22" });
    expect(await queue()).toEqual([]);

    await t.call("brain_organize", { action: "set_read_status", item_id: b.id, read_status: "unread" });
    expect(await queue({ query: "mcp" })).toEqual(["Podcast on MCP"]);
  });

  it("refuses set_read_status on a type with its own status", async () => {
    const book = await save({ title: "Dune", content_md: "", type: "book" });
    const res = await t.call("brain_organize", { action: "set_read_status", item_id: book.id, read_status: "read" });
    expect(res.isError).toBe(true);
  });

  it("creates the daily note once and replaces the section on the next call", async () => {
    const first = await save({ date: "2026-10-23", section: "Noema Brief", content_md: "Day one" });
    expect(first).toMatchObject({ created: true, type: "daily_note", slug: "2026-10-23", folder_path: "10_Notes/Daily" });
    const second = await save({ date: "2026-10-23", section: "Noema Brief", content_md: "Day one, updated" });
    expect(second).toMatchObject({ id: first.id, created: false, changed: true });
    const item = (await t.call("brain_get_item", { id: first.id })).json.item;
    expect(item.content_md).toBe("## Noema Brief\n\nDay one, updated\n");
    const same = await save({ date: "2026-10-23", section: "Noema Brief", content_md: "Day one, updated" });
    expect(same.changed).toBe(false);
  });

  it("rejects top-level headings inside a section", async () => {
    const res = await t.call("brain_save_item", { date: "2026-10-23", section: "Noema Brief", content_md: "## Nope" });
    expect(res.isError).toBe(true);
  });
});
