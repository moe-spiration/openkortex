import { describe, expect, it } from "vitest";
import {
  NEW_NOTE_PREFILL_KEY,
  NEW_NOTE_PREFILL_TTL_MS,
  cleanPrefill,
  isNewNoteKey,
  takeNewNotePrefill,
  writeNewNotePrefill,
} from "./new-note";

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("new-note prefill (openNewNote hand-over)", () => {
  it("writes and takes it once", () => {
    const s = memory();
    writeNewNotePrefill({ title: "  Idee  ", body: "Text\n\n" }, s, 1000);
    expect(JSON.parse(s.m.get(NEW_NOTE_PREFILL_KEY)!)).toEqual({ title: "Idee", body: "Text", at: 1000 });
    expect(takeNewNotePrefill(s, 2000)).toEqual({ title: "Idee", body: "Text" });
    expect(takeNewNotePrefill(s, 2000)).toBeNull();
  });

  it("an empty prefill clears an old one", () => {
    const s = memory();
    writeNewNotePrefill({ title: "Alt" }, s, 1);
    writeNewNotePrefill(undefined, s, 2);
    expect(s.m.has(NEW_NOTE_PREFILL_KEY)).toBe(false);
    expect(cleanPrefill({ title: " ", body: "  \n" })).toBeNull();
  });

  it("keeps a template on its own and drops malformed template values", () => {
    expect(cleanPrefill({ template: "pick" })).toEqual({ template: "pick" });
    expect(cleanPrefill({ title: "A", template: "Meeting Notiz!" })).toEqual({ title: "A" });
    expect(cleanPrefill({ template: 3 as unknown as string })).toBeNull();
  });

  it("ignores stale and malformed values", () => {
    const s = memory();
    writeNewNotePrefill({ body: "x" }, s, 0);
    expect(takeNewNotePrefill(s, NEW_NOTE_PREFILL_TTL_MS + 1)).toBeNull();
    s.setItem(NEW_NOTE_PREFILL_KEY, "{oops");
    expect(takeNewNotePrefill(s, 0)).toBeNull();
    expect(takeNewNotePrefill(null)).toBeNull();
  });
});

describe("new-note shortcut", () => {
  const k = (o: Partial<KeyboardEvent>) => ({ key: "n", code: "KeyN", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  it("Alt+N and Ctrl/Cmd+N, not plain N, Shift or AltGr (Ctrl+Alt)", () => {
    expect(isNewNoteKey(k({ altKey: true }))).toBe(true);
    expect(isNewNoteKey(k({ ctrlKey: true }))).toBe(true);
    expect(isNewNoteKey(k({ metaKey: true, key: "N" }))).toBe(true);
    expect(isNewNoteKey(k({}))).toBe(false);
    expect(isNewNoteKey(k({ altKey: true, shiftKey: true }))).toBe(false);
    expect(isNewNoteKey(k({ altKey: true, ctrlKey: true }))).toBe(false);
    expect(isNewNoteKey(k({ altKey: true, key: "m", code: "KeyM" }))).toBe(false);
  });
});
