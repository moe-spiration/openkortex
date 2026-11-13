import { describe, expect, it } from "vitest";
import {
  detectIntent,
  initialOrbitState,
  orbitCanSend,
  orbitHint,
  orbitMicLabel,
  orbitRecordingHint,
  orbitReducer,
  orbitStep,
  stripQuestionPrefix,
  type OrbitEvent,
  type OrbitState,
} from "./orbit";

// Every case of the acceptance list (03-akzeptanz-und-tests.md, A-12) = the reference self test.
const CASES: Array<[string, "capture" | "ask", "note" | "link" | "question"]> = [
  ["Idee: Preismodell für die App", "capture", "note"],
  ["https://example.com/artikel", "capture", "link"],
  ["www.example.com/a?b=1", "capture", "link"],
  ["Lesenswert https://example.com", "capture", "link"],
  ["Wie hängen Pricing und Retention zusammen?", "ask", "question"],
  ["Pricing und Retention?", "ask", "question"],
  ["? Was habe ich zu Pricing notiert", "ask", "question"],
  ["Was sind meine offenen Aufgaben", "ask", "question"],
  ["Was", "capture", "note"],
  ["Wie geht das", "ask", "question"],
  ["Wann ist das Meeting?", "ask", "question"],
  ["Wiese hinter dem Haus kaufen", "capture", "note"],
  ["Ist das ein Test", "ask", "question"],
  ["Heute Morgen gelaufen, 5 km", "capture", "note"],
  ["What did I note about pricing", "ask", "question"],
  ["Ok?", "capture", "note"],
];

describe("detectIntent (A-12, port of orbit-detect.js)", () => {
  it.each(CASES)("%s → %s/%s", (text, mode, kind) => {
    expect(detectIntent(text)).toMatchObject({ mode, kind });
  });

  it('"?" prefix: ask and the prefix is to be stripped', () => {
    expect(detectIntent("? Was habe ich zu Pricing notiert")).toEqual({
      mode: "ask",
      kind: "question",
      stripPrefix: true,
    });
    expect(stripQuestionPrefix("? Was habe ich zu Pricing notiert")).toBe("Was habe ich zu Pricing notiert");
    expect(detectIntent("Wann ist das Meeting?")?.stripPrefix).toBeUndefined();
  });

  it("empty or only spaces → no result", () => {
    for (const t of ["", "   ", "\n\t", null, undefined]) expect(detectIntent(t)).toBeNull();
  });

  it("files present → capture/file, whatever the text", () => {
    for (const t of ["", "Wie geht das?", "https://example.com"])
      expect(detectIntent(t, { hasFiles: true })).toEqual({ mode: "capture", kind: "file" });
  });

  it("extra rule edges: two URLs are a note, a link with more than three words of comment is a note", () => {
    expect(detectIntent("https://a.example https://b.example")).toMatchObject({ kind: "note" });
    expect(detectIntent("Das hier unbedingt später lesen https://example.com")).toMatchObject({ kind: "note" });
    expect(detectIntent("Lesen: https://example.com heute")).toMatchObject({ kind: "link" });
    expect(detectIntent("WIE geht das")).toMatchObject({ mode: "ask" }); // case-insensitive
    expect(detectIntent("Wie, geht das")).toMatchObject({ mode: "ask" }); // punctuation on the first word
  });

  it("is fast: 1000 calls under 50 ms", () => {
    const inputs = [...CASES.map((c) => c[0]), "", "   "];
    for (let i = 0; i < 200; i++) detectIntent(inputs[i % inputs.length]); // warm-up
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) detectIntent(inputs[i % inputs.length]);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

const run = (events: OrbitEvent[], start: OrbitState = initialOrbitState()) => {
  let state = start;
  const effects = [];
  for (const e of events) {
    const step = orbitStep(state, e);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
};

describe("Orbit-Bar state (Zustandstests 0–6)", () => {
  it("(0) mic click starts recording, a second click ends it; discard/escape reset and save nothing", () => {
    const started = run([{ type: "input", text: "Entwurf" }, { type: "mic" }]);
    expect(started.state.recording).toBe(true);
    expect(started.effects).toContainEqual({ type: "startRecording", purpose: "dictation" });
    expect(started.effects).toContainEqual({ type: "announce", message: "Aufnahme läuft" });

    const stopped = run([{ type: "mic", transcript: "Milch kaufen" }], started.state);
    expect(stopped.state.recording).toBe(false);
    expect(stopped.effects).toContainEqual({ type: "stopRecording" });

    for (const cancel of [{ type: "discard" }, { type: "escape" }] as const) {
      const r = run([cancel], started.state);
      expect(r.state.recording).toBe(false);
      expect(r.state.text).toBe("Entwurf"); // field unchanged
      expect(r.effects).toContainEqual({ type: "discardRecording" });
      expect(r.effects.some((e) => e.type === "capture" || e.type === "ask")).toBe(false); // inbox unchanged
    }
  });

  it("(1) typing a question without a pinned mode switches to Fragen and shows Auto → Antwort", () => {
    const r = run([{ type: "input", text: "Wie hängen Pricing und Retention zusammen?" }]);
    expect(r.state).toMatchObject({ mode: "ask", pinned: false, kind: "question" });
    expect(orbitHint(r.state)).toBe("Auto → Antwort");
    expect(r.effects).toContainEqual({ type: "announce", message: "Modus: Fragen, automatisch erkannt" });
  });

  it("(2) clicking Festhalten, then typing a question stays on Festhalten", () => {
    const r = run([
      { type: "segment", mode: "capture" },
      { type: "input", text: "Wie hängen Pricing und Retention zusammen?" },
    ]);
    expect(r.state).toMatchObject({ mode: "capture", pinned: true });
    expect(orbitHint(r.state)).toBe("→ Inbox");
    expect(r.effects.some((e) => e.type === "announce")).toBe(false);
  });

  it("(3) Escape resets to Auto: field empty, unpinned, Festhalten", () => {
    const r = run([
      { type: "segment", mode: "ask" },
      { type: "input", text: "Notiz" },
      { type: "escape" },
    ]);
    expect(r.state).toMatchObject({ text: "", mode: "capture", pinned: false, kind: null });
    const after = run([{ type: "input", text: "Was sind meine offenen Aufgaben" }], r.state);
    expect(after.state.mode).toBe("ask"); // auto works again
  });

  it("(4) submit empties the field and unpins; nothing happens with an empty field", () => {
    const r = run([
      { type: "segment", mode: "ask" },
      { type: "input", text: "Was habe ich zu Pricing notiert" },
      { type: "submit" },
    ]);
    expect(r.effects).toContainEqual({ type: "ask", text: "Was habe ich zu Pricing notiert" });
    expect(r.state).toMatchObject({ text: "", pinned: false, mode: "capture" });

    const link = run([{ type: "input", text: "https://example.com/artikel" }, { type: "submit" }]);
    expect(link.effects).toContainEqual({ type: "capture", text: "https://example.com/artikel", kind: "link" });

    const empty = run([{ type: "input", text: "   " }, { type: "submit" }]);
    expect(empty.effects).toEqual([]);
    expect(orbitCanSend(empty.state)).toBe(false);
  });

  it("(5) mic: Sprachfrage in ask, Diktat in capture, only on click", () => {
    const capture = initialOrbitState();
    expect(orbitMicLabel(capture)).toBe("Diktat starten");
    const ask = orbitReducer(capture, { type: "segment", mode: "ask" });
    expect(orbitMicLabel(ask)).toBe("Sprachfrage starten");

    // Focus, typing, segment or Tab never start a recording.
    const typed = run([{ type: "input", text: "Hallo" }, { type: "tab" }, { type: "segment", mode: "capture" }]);
    expect(typed.state.recording).toBe(false);
    expect(typed.effects.some((e) => e.type === "startRecording")).toBe(false);

    const q = run([{ type: "mic" }], ask);
    expect(q.effects).toContainEqual({ type: "startRecording", purpose: "voiceQuestion" });
    expect(orbitMicLabel(q.state)).toBe("Aufnahme beenden");
    expect(orbitRecordingHint(q.state)).toBe("Kortex hört zu · Orb tippen übernimmt");
    expect(orbitRecordingHint(run([{ type: "mic" }]).state)).toBe("Kortex hört zu · Orb tippen speichert");
  });

  it("(6) accent colour of the orbs is a UI token concern: the state has no colour", () => {
    // The orbs read the accent token from the settings (P5 / A-22); nothing in the state may pin a
    // colour, so a settings change re-colours them without a state transition.
    const s = initialOrbitState();
    expect(Object.keys(s).sort()).toEqual(["kind", "mode", "pinned", "recording", "sendVoiceImmediately", "text"]);
  });
});

describe("Orbit-Bar transitions (W9 table)", () => {
  it('"?" prefix strips the character, switches to Fragen and keeps it while typing on', () => {
    const r = run([{ type: "input", text: "? Was" }]);
    expect(r.state).toMatchObject({ text: "Was", mode: "ask", pinned: true });
    const more = run([{ type: "input", text: "Was habe" }], r.state);
    expect(more.state.mode).toBe("ask");
  });

  it("an empty field returns to Festhalten unless pinned", () => {
    const r = run([{ type: "input", text: "Wann ist das Meeting?" }, { type: "input", text: "" }]);
    expect(r.state).toMatchObject({ mode: "capture", kind: null });
    expect(orbitHint(r.state)).toBeNull();
    const pinned = run([{ type: "segment", mode: "ask" }, { type: "input", text: "" }]);
    expect(pinned.state.mode).toBe("ask");
  });

  it("Tab toggles the mode and pins it", () => {
    const once = orbitReducer(initialOrbitState(), { type: "tab" });
    expect(once).toMatchObject({ mode: "ask", pinned: true });
    expect(orbitReducer(once, { type: "tab" })).toMatchObject({ mode: "capture", pinned: true });
  });

  it("hint: Link → Inbox for a detected link, Auto → Inbox for a note", () => {
    expect(orbitHint(run([{ type: "input", text: "Lesenswert https://example.com" }]).state)).toBe("Link → Inbox");
    expect(orbitHint(run([{ type: "input", text: "Idee: Preismodell" }]).state)).toBe("Auto → Inbox");
  });

  it("drop: capture without touching pinned or the field", () => {
    const start = run([{ type: "segment", mode: "ask" }, { type: "input", text: "Frage" }]).state;
    const files = orbitStep(start, { type: "drop", files: 2 });
    expect(files.state).toMatchObject({ mode: "capture", pinned: true, text: "Frage" });
    expect(files.effects).toEqual([{ type: "captureFiles", files: 2 }]);
    const link = orbitStep(initialOrbitState(), { type: "drop", text: "https://example.com" });
    expect(link.effects).toEqual([{ type: "capture", text: "https://example.com", kind: "link" }]);
    expect(orbitStep(initialOrbitState(), { type: "drop" }).effects).toEqual([]);
  });

  it("dictation (capture) stores the transcript as a note; the field stays as it was", () => {
    const r = run([{ type: "mic" }, { type: "mic", transcript: "Morgen Zahnarzt anrufen" }]);
    expect(r.effects).toContainEqual({ type: "capture", text: "Morgen Zahnarzt anrufen", kind: "note" });
    expect(r.state).toMatchObject({ recording: false, text: "" });
  });

  it("voice question puts the transcript into the field and runs detection when unpinned", () => {
    const ask = orbitReducer(initialOrbitState(), { type: "segment", mode: "ask" });
    const r = run([{ type: "mic" }, { type: "mic", transcript: "Was steht in meinen Notizen zu Pricing" }], ask);
    expect(r.state).toMatchObject({ text: "Was steht in meinen Notizen zu Pricing", mode: "ask" });
    expect(r.effects.some((e) => e.type === "ask")).toBe(false); // sending is the user's next step
    expect(run([{ type: "submit" }], r.state).effects).toContainEqual({
      type: "ask",
      text: "Was steht in meinen Notizen zu Pricing",
    });
  });

  it('"Sprachfragen sofort senden": the orb sends the transcript', () => {
    const ask = orbitReducer(initialOrbitState({ sendVoiceImmediately: true }), { type: "segment", mode: "ask" });
    expect(orbitRecordingHint({ ...ask, recording: true })).toBe("Kortex hört zu · Orb tippen sendet");
    const r = run([{ type: "mic" }, { type: "mic", transcript: "Wie lief die Woche" }], ask);
    expect(r.effects).toContainEqual({ type: "ask", text: "Wie lief die Woche" });
    expect(r.state).toMatchObject({ text: "", pinned: false, recording: false });
  });

  it("typing and submit are ignored while recording", () => {
    const rec = run([{ type: "input", text: "Notiz" }, { type: "mic" }]).state;
    expect(orbitReducer(rec, { type: "input", text: "anders" }).text).toBe("Notiz");
    expect(orbitStep(rec, { type: "submit" }).effects).toEqual([]);
    expect(orbitHint(rec)).toBeNull();
    expect(orbitCanSend(rec)).toBe(false);
  });
});
