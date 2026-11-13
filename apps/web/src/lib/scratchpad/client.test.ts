import { describe, expect, it } from "vitest";
import {
  acceptable,
  deleteDecision,
  dropPending,
  isCodeEntry,
  isScratchpadKey,
  isSubmitKey,
  mergeEntries,
  noteDecision,
  padWhen,
  pendingEntry,
  toDecisions,
  withoutEntry,
  type PadSuggestion,
} from "./client";

const key = (o: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...o }) as KeyboardEvent;

describe("scratchpad client", () => {
  it("Alt+J opens, AltGr (Ctrl+Alt) and Shift do not", () => {
    expect(isScratchpadKey(key({ altKey: true, key: "j", code: "KeyJ" }))).toBe(true);
    expect(isScratchpadKey(key({ altKey: true, ctrlKey: true, key: "j", code: "KeyJ" }))).toBe(false);
    expect(isScratchpadKey(key({ key: "j", code: "KeyJ" }))).toBe(false);
  });

  it("Ctrl/Cmd+Enter submits, plain Enter does not", () => {
    expect(isSubmitKey(key({ key: "Enter", ctrlKey: true }))).toBe(true);
    expect(isSubmitKey(key({ key: "Enter", metaKey: true }))).toBe(true);
    expect(isSubmitKey(key({ key: "Enter" }))).toBe(false);
  });

  it("optimistic entry shows at once and is swapped for the server list", () => {
    const p = pendingEntry("hallo", new Date("2026-10-31T14:05:00Z"), "tmp-1");
    expect(p).toMatchObject({ pending: true, at: "2026-10-31 14:05" });
    const server = [{ id: "a", at: "2026-10-31 14:05", text: "hallo" }];
    expect(mergeEntries(server, dropPending([p], "tmp-1"))).toEqual(server);
    expect(mergeEntries(server, [p])).toHaveLength(2); // still in flight
  });

  it("accept all skips `keep` and carries title / target", () => {
    const s: PadSuggestion[] = [
      { entry_id: "1", action: "task", title: "Steuer" },
      { entry_id: "2", action: "keep" },
      { entry_id: "3", action: "object", target_item_id: "uuid" },
      { entry_id: "4", action: "discard" },
    ];
    expect(acceptable(s)).toHaveLength(3);
    expect(toDecisions(s)).toEqual([
      { entry_id: "1", action: "task", title: "Steuer" },
      { entry_id: "3", action: "object", target_item_id: "uuid" },
      { entry_id: "4", action: "discard" },
    ]);
  });

  it("delete removes one entry optimistically and sends a discard decision", () => {
    const list = [
      { id: "a", at: "2026-11-03 10:00", text: "eins" },
      { id: "b", at: "2026-11-03 10:01", text: "zwei" },
    ];
    expect(withoutEntry(list, "a")).toEqual([list[1]]);
    expect(deleteDecision("a")).toEqual([{ entry_id: "a", action: "discard" }]);
  });
});

describe("scratchpad popover helpers (Feinschliff Live)", () => {
  // Local "now"; the stamps are UTC, so build them from local dates to stay zone independent.
  const now = new Date(2026, 10, 7, 12, 0);
  const utc = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

  it("padWhen: Heute, Gestern, weekday within a week, else the date", () => {
    expect(padWhen(utc(new Date(2026, 10, 7, 8, 40)), now)).toBe("Heute 08:40");
    expect(padWhen(utc(new Date(2026, 10, 6, 22, 5)), now)).toBe("Gestern 22:05");
    expect(padWhen(utc(new Date(2026, 10, 3, 19, 12)), now)).toBe("Di 19:12");
    expect(padWhen(utc(new Date(2026, 9, 3, 7, 0)), now)).toBe("03.10.2026 07:00");
    expect(padWhen("irgendwann", now)).toBe("irgendwann");
  });

  it("isCodeEntry: fenced code blocks only", () => {
    expect(isCodeEntry("Nummer\n```\n+49 170\n```")).toBe(true);
    expect(isCodeEntry("Rückruf Bank `inline`")).toBe(false);
  });

  it("noteDecision: one note decision without a title (the server takes the first line)", () => {
    expect(noteDecision("a1")).toEqual([{ entry_id: "a1", action: "note" }]);
  });
});
