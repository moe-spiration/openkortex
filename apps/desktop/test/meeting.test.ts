import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBridge, DEMO_CARDS, DEMO_EVERY } from "@/bridge/mock";
import { initialMeeting, levelOf, MAX_LINES, meetingReducer, transcriberLabel, type MeetingEvent } from "@/state/meeting";

const run = (events: MeetingEvent[]) => events.reduce(meetingReducer, initialMeeting());
const final = (channel: 0 | 1, text: string, ts = "00:15"): MeetingEvent => ({
  type: "final",
  p: { channel, speaker: channel ? "Gesprächspartner" : "Ich", ts, text },
});

describe("meeting reducer (H1)", () => {
  it("collects final lines and clips in order, and clears the channel's partial", () => {
    const s = run([
      { type: "partial", p: { channel: 1, speaker: "Gesprächspartner", ts: "00:10", text: "Und wer" } },
      final(1, "Und wer entscheidet?"),
      { type: "clip", ts: "00:20", text: "" },
      final(0, "  "),
    ]);
    expect(s.lines.map((l) => [l.kind, l.who, l.text])).toEqual([
      ["speech", "Gesprächspartner", "Und wer entscheidet?"],
      ["clip", "Clip", "Markierter Moment"],
    ]);
    expect(s.partial).toEqual([null, null]);
    expect(new Set(s.lines.map((l) => l.id)).size).toBe(2);
  });

  it("keeps the newest MAX_LINES lines", () => {
    const s = run(Array.from({ length: MAX_LINES + 5 }, (_, i) => final(0, `Zeile ${i}`)));
    expect(s.lines).toHaveLength(MAX_LINES);
    expect(s.lines[0]!.text).toBe("Zeile 5");
  });

  it("tracks session, transcriber, coaching and the upload result", () => {
    const s = run([
      { type: "session", p: { state: "live", item_id: "i1", title: "Sync", transcriber: "edenai:deepgram" } },
      { type: "transcript", p: { state: "error", message: "402" } },
      { type: "coach", p: { state: "loading" } },
      { type: "cards", p: { cards: [...DEMO_CARDS, ...DEMO_CARDS], at: "01:00" } },
      { type: "upload", p: { state: "done", segments: 12 } },
    ]);
    expect(s.session).toMatchObject({ state: "live", itemId: "i1", title: "Sync" });
    expect(s.transcript).toEqual({ state: "error", transcriber: "edenai:deepgram", message: "402" });
    expect(s.cards).toHaveLength(3);
    expect(s.coach).toEqual({ state: "idle", message: null, at: "01:00" });
    expect(s.result).toMatchObject({ state: "done", itemId: "i1", segments: 12 });
    expect(meetingReducer(s, { type: "reset" })).toEqual(initialMeeting());
  });

  it("labels the transcriber and maps dBFS to the wave level", () => {
    expect(transcriberLabel("edenai:deepgram")).toBe("Eden AI · deepgram");
    expect(transcriberLabel("deepgram:nova-3")).toBe("Deepgram Nova-3");
    expect(transcriberLabel(null)).toBe("Transkription");
    expect(levelOf(-60)).toBe(0.2);
    expect(levelOf(-15)).toBe(1);
  });
});

describe("mock bridge meeting replay (browser preview only)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("replays the session, transcript lines and coaching as Rust events", async () => {
    const b = createMockBridge();
    const got: string[] = [];
    b.listen("meeting:live", (p) => got.push(`live:${p.state}`));
    b.listen("transcript:final", (p) => got.push(`line:${p.channel}`));
    b.listen("coaching:cards", (p) => got.push(`cards:${p.cards.length}`));
    vi.advanceTimersByTime(100);
    expect(got).toEqual(["live:live", "line:0", "line:1"]);
    vi.advanceTimersByTime(DEMO_EVERY * 1000);
    expect(got.slice(3)).toEqual(["line:1", "cards:3"]);
    await expect(b.invoke("meeting_clip", { text: "Budget" })).resolves.toMatchObject({ text: "Budget" });
    const ups: string[] = [];
    b.listen("meeting:upload", (u) => ups.push(u.state));
    const stopped = b.invoke("stop_recording");
    vi.advanceTimersByTime(2000);
    await stopped;
    expect(ups).toEqual(["uploading", "done"]);
    b.dispose();
  });
});
