import { describe, expect, it } from "vitest";
import { announce, describe as describeFresh, type DueItem } from "./announce";

const a: DueItem = { id: "a", title: "Steuer", remind_at: "2026-11-03T08:00:00.000Z", kind: "reminder" };
const r: DueItem = { id: "radar:b:2026-11-03T09:00:00.000Z", title: "Preise", remind_at: "2026-11-03T09:00:00.000Z", kind: "radar" };

describe("announce", () => {
  it("announces an item once", () => {
    const first = announce([a, r], {});
    expect(first.fresh.map((i) => i.id)).toEqual(["a", r.id]);
    expect(announce([a, r], first.next).fresh).toEqual([]);
  });

  it("announces a snoozed reminder again (same id, new time) and forgets cleared ones", () => {
    const first = announce([a], {});
    const snoozed = { ...a, remind_at: "2026-11-04T08:00:00.000Z" };
    expect(announce([snoozed], first.next).fresh).toEqual([snoozed]);
    expect(announce([], first.next).next).toEqual({});
  });

  it("words one item and a summary", () => {
    expect(describeFresh([a])).toEqual({ title: "Erinnerung", body: "Steuer" });
    expect(describeFresh([r])).toEqual({ title: "Seite hat sich geändert", body: "Preise" });
    expect(describeFresh([a, r])).toEqual({ title: "2 neue Hinweise", body: "1 Erinnerung und 1 Seitenänderung" });
  });
});
