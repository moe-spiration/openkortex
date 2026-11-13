import { describe, expect, it } from "vitest";
import { parseRemindAction, remindSection } from "./reminder-menu";

const NOW = new Date("2026-11-02T10:00:00Z");
const DAY = "2026-11-02";

describe("remindSection", () => {
  it("offers the snooze presets, without removal when nothing is set", () => {
    const s = remindSection(false, NOW, DAY);
    expect(s.map((a) => a.label)).toEqual(["Erinnern: Heute Abend", "Erinnern: Morgen", "Erinnern: Nächste Woche"]);
    expect(s.every((a) => parseRemindAction(a.id) !== undefined && parseRemindAction(a.id) !== null)).toBe(true);
  });
  it("adds Erinnerung entfernen when a reminder is set", () => {
    const s = remindSection(true, NOW, DAY);
    expect(s.at(-1)?.label).toBe("Erinnerung entfernen");
    expect(parseRemindAction(s.at(-1)!.id)).toBeNull();
  });
});

describe("parseRemindAction", () => {
  it("round-trips an instant and ignores other actions", () => {
    expect(parseRemindAction("remind:2026-11-03T07:00:00.000Z")).toBe("2026-11-03T07:00:00.000Z");
    expect(parseRemindAction("remind:clear")).toBeNull();
    expect(parseRemindAction("remind:kaputt")).toBeUndefined();
    expect(parseRemindAction("delete")).toBeUndefined();
  });
});
