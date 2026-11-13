import { describe, expect, it } from "vitest";
import { itemToEntry, type ItemRow } from "../src/data/live";
import { remindOptions } from "../src/lib/remind";

describe("remindOptions", () => {
  it("offers tonight 18:00, tomorrow 08:00 and next Monday 08:00", () => {
    const [tonight, tomorrow, nextWeek] = remindOptions(new Date(2026, 10, 4, 10, 0)); // Wed
    expect([tonight!.key, new Date(tonight!.iso).getHours(), new Date(tonight!.iso).getDate()]).toEqual(["tonight", 18, 4]);
    expect([new Date(tomorrow!.iso).getDate(), new Date(tomorrow!.iso).getHours()]).toEqual([5, 8]);
    expect([new Date(nextWeek!.iso).getDay(), new Date(nextWeek!.iso).getDate()]).toEqual([1, 9]);
  });

  it("moves tonight to 21:00 after 18:00, drops it after 21:00 and skips to Monday on a Sunday evening", () => {
    expect(new Date(remindOptions(new Date(2026, 10, 4, 19, 0))[0]!.iso).getHours()).toBe(21);
    expect(remindOptions(new Date(2026, 10, 4, 22, 0)).map((o) => o.key)).toEqual(["tomorrow", "next-week"]);
    const sunday = remindOptions(new Date(2026, 10, 8, 12, 0)); // Sun 8 Nov
    expect(new Date(sunday[2]!.iso).getDate()).toBe(9);
  });
});

describe("item → entry reminder", () => {
  it("carries remind_at into the entry for the detail sheet", () => {
    const row: ItemRow = {
      id: "i1",
      type: "article",
      title: "T",
      summary: null,
      content_md: "x",
      tags: [],
      status: "processed",
      folder_path: "00_Inbox",
      cover_image_url: null,
      metadata: null,
      entities: [],
      remind_at: "2026-11-05T07:00:00Z",
      created_at: new Date(2026, 9, 24, 9).toISOString(),
      updated_at: new Date(2026, 9, 24, 9).toISOString(),
    };
    expect(itemToEntry(row, new Date(2026, 9, 24, 15), (k) => ({ uri: `art:${k}` })).remindAt).toBe("2026-11-05T07:00:00Z");
    expect(itemToEntry({ ...row, remind_at: undefined }, new Date(2026, 9, 24, 15), (k) => ({ uri: `art:${k}` })).remindAt).toBeNull();
  });
});
