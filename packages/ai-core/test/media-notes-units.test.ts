import { describe, expect, it } from "vitest";
import { normalizeMediaNotes, renderMediaNote, stampToSec, type MediaNotes } from "../src/media/notes";

// Chapter start times from the model come as "[mm:ss]" text and are converted in code, so a
// 12-minute video no longer gets chapters at "0, 1, 38" (minutes/seconds mix-up).

describe("stampToSec", () => {
  it("parses mm:ss, h:mm:ss, brackets and plain seconds", () => {
    expect(stampToSec("00:38")).toBe(38);
    expect(stampToSec("[11:48]")).toBe(708);
    expect(stampToSec("1:02:03")).toBe(3723);
    expect(stampToSec(25)).toBe(25);
    expect(stampToSec("25")).toBe(25);
    expect(stampToSec("irgendwann")).toBeNull();
    expect(stampToSec(null)).toBeNull();
  });
});

describe("media notes time units", () => {
  const segments = Array.from({ length: 24 }, (_, i) => ({ startSec: i * 30, text: `Satz ${i}` })); // 12 min
  const raw = {
    summary: "s",
    chapters: [
      { title: "Intro", start_sec: "0:00" },
      { title: "Teil 1", start_sec: "03:10" },
      { title: "Teil 2", start_sec: "9:05" },
    ],
    key_takeaways: [],
    learnings: [],
    quotes: [{ text: "Zitat", speaker: null, time_sec: "11:48" }],
    resources: [],
  };

  it("converts stamp text to seconds", () => {
    const n = normalizeMediaNotes(raw);
    expect(n.chapters.map((c) => c.start_sec)).toEqual([0, 190, 545]);
    expect(n.quotes[0]?.time_sec).toBe(708);
  });

  it("drops chapters that lie beyond the end of the transcript", () => {
    const notes: MediaNotes = {
      ...normalizeMediaNotes(raw),
      chapters: [
        { title: "Intro", start_sec: 0 },
        { title: "Zu spät", start_sec: 4000 },
      ],
    };
    const out = renderMediaNote({ title: "T", facts: [], jump: () => null, notes, segments });
    expect(out.chapters).toEqual([{ title: "Intro", start_sec: 0 }]);
  });
});
