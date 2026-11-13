import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { KNOWLEDGE_ITEM_TYPES } from "@kortex/db";
import { connect } from "./helpers";

let t: Awaited<ReturnType<typeof connect>>;
beforeEach(async () => {
  t = await connect();
});
afterEach(() => t.close());

const save = async (args: Record<string, unknown>) => (await t.call("brain_save_item", args)).json;

// scratchpad is registered by the type-registry migration; include it once @kortex/db knows it.
const TYPES = ["session", "prompt", "scratchpad"].filter((x) =>
  (KNOWLEDGE_ITEM_TYPES as readonly string[]).includes(x),
);

describe("surface stays at six tools", () => {
  it("has exactly six tools, reminders/types add none", async () => {
    const { tools } = await t.client.listTools();
    expect(tools).toHaveLength(6);
  });

  it("brain_organize lists snooze and clear_reminder", async () => {
    const { tools } = await t.client.listTools();
    const props = tools.find((x) => x.name === "brain_organize")?.inputSchema.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(props.action?.enum).toEqual(expect.arrayContaining(["snooze", "clear_reminder"]));
  });
});

describe("brain_search type filter derives from the registry", () => {
  it("offers exactly the registry types", async () => {
    const { tools } = await t.client.listTools();
    const props = tools.find((x) => x.name === "brain_search")?.inputSchema.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(props.type?.enum).toEqual([...KNOWLEDGE_ITEM_TYPES]);
    for (const type of TYPES) expect(props.type?.enum).toContain(type);
  });

  it.each(TYPES)("filters %s and honours remind_due_by", async (type) => {
    const due = await save({ title: `${type} due`, content_md: "x", type });
    const later = await save({ title: `${type} later`, content_md: "y", type });
    await t.call("brain_save_item", { id: due.id, remind_at: "2026-01-01T08:00:00Z" });
    await t.call("brain_save_item", { id: later.id, remind_at: "2099-01-01T08:00:00Z" });
    const byType = (await t.call("brain_search", { type })).json;
    expect(byType.count).toBe(2);
    const dueOnly = (await t.call("brain_search", { types: [type], remind_due_by: "2026-06-01T00:00:00Z" }))
      .json;
    expect(dueOnly.results.map((r: { item_id: string }) => r.item_id)).toEqual([due.id]);
  });
});

describe("brain_organize snooze / clear_reminder", () => {
  it("sets and clears the reminder", async () => {
    const type = TYPES[0]!;
    const item = await save({ title: "Tab session", content_md: "z", type });
    const snoozed = await t.call("brain_organize", {
      action: "snooze",
      item_id: item.id,
      date: "2026-12-24T10:00:00+01:00",
    });
    expect(snoozed.json).toMatchObject({ action: "snooze", remind_at: "2026-12-24T09:00:00.000Z" });
    const due = (await t.call("brain_search", { remind_due_by: "2026-12-31T00:00:00Z" })).json;
    expect(due.results.map((r: { item_id: string }) => r.item_id)).toEqual([item.id]);
    const cleared = await t.call("brain_organize", { action: "clear_reminder", item_id: item.id });
    expect(cleared.json.remind_at).toBeNull();
    const none = (await t.call("brain_search", { remind_due_by: "2026-12-31T00:00:00Z" })).json;
    expect(none.count).toBe(0);
  });

  it("validates arguments", async () => {
    const item = await save({ title: "N", content_md: "z", type: "note" });
    expect((await t.call("brain_organize", { action: "snooze", item_id: item.id })).isError).toBe(true);
    expect(
      (await t.call("brain_organize", { action: "snooze", item_id: item.id, date: "morgen" })).isError,
    ).toBe(true);
    expect((await t.call("brain_organize", { action: "snooze", date: "2026-12-24" })).isError).toBe(true);
    expect(
      (await t.call("brain_organize", { action: "clear_reminder", item_id: randomUUID() })).isError,
    ).toBe(true);
  });
});
