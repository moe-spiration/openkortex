import { describe, expect, it } from "vitest";
import { initialOrbitState, orbitStep, type OrbitState } from "@kortex/db/orbit";
import {
  COMMAND_SKILL,
  applyMention,
  availableScopes,
  barHint,
  clipboardUrl,
  commandQuery,
  detectMention,
  domainOf,
  dropLabel,
  editorPrefill,
  effectiveScope,
  enterAction,
  extractTags,
  filterCommands,
  focusSuggestions,
  INBOX_FOLDER,
  linkObjectMentions,
  matchObjects,
  matchTags,
  nextEnabled,
  OBJECTS_FOLDER,
  parseCommand,
  scopeBody,
  spaceContext,
  splitLink,
  planCapture,
  purposeFor,
  recordingHint,
  routeTranscript,
  targetLabel,
} from "./orbit";

const typed = (text: string, over: Partial<OrbitState> = {}): OrbitState =>
  orbitStep({ ...initialOrbitState(), ...over }, { type: "input", text }).state;

describe("planCapture (chip target, K6)", () => {
  it("Auto: ingest, Kortex sorts it in (note or link)", () => {
    expect(planCapture("Idee: Preismodell", "auto")).toEqual({
      to: "ingest",
      text: "Idee: Preismodell",
    });
    expect(planCapture("https://example.com/a", "auto")).toEqual({
      to: "ingest",
      text: "https://example.com/a",
    });
  });

  it("Inbox: ingest pinned to 00_Inbox (manual placement, no auto-sorting)", () => {
    expect(planCapture("Notiz", "inbox")).toEqual({
      to: "ingest",
      text: "Notiz",
      folderPath: INBOX_FOLDER,
    });
  });

  it("Journal: one Mind Dump line; Aufgabe: a task title", () => {
    expect(planCapture("  Gedanke\nmit Umbruch ", "journal")).toEqual({
      to: "journal",
      text: "Gedanke mit Umbruch",
    });
    expect(planCapture("Steuer bis Freitag", "task")).toEqual({
      to: "task",
      title: "Steuer bis Freitag",
    });
    expect((planCapture("x".repeat(600), "task") as { title: string }).title).toHaveLength(500);
  });

  it("nothing for an empty field", () => {
    expect(planCapture("   ", "auto")).toBeNull();
  });
});

describe("routeTranscript: voice goes by intent, not always into the inbox", () => {
  const base = { pinned: false, mode: "capture" as const, sendVoiceImmediately: false };

  it("Diktat with a note: saved like a typed capture", () => {
    expect(routeTranscript("Morgen Zahnarzt anrufen", { ...base, purpose: "dictation" })).toEqual({
      to: "capture",
      text: "Morgen Zahnarzt anrufen",
    });
  });

  it("Diktat that is a question (bar not pinned): lands in the field as a question, auto", () => {
    expect(
      routeTranscript("Was habe ich zu Pricing notiert?", { ...base, purpose: "dictation" }),
    ).toEqual({
      to: "field",
      text: "Was habe ich zu Pricing notiert?",
      mode: "ask",
      auto: true,
    });
  });

  it("Diktat with Festhalten pinned: saved even when it sounds like a question", () => {
    expect(
      routeTranscript("Wie geht das", { ...base, pinned: true, purpose: "dictation" }),
    ).toEqual({
      to: "capture",
      text: "Wie geht das",
    });
  });

  it("Sprachfrage: into the field (default) or sent at once (setting)", () => {
    const q = { ...base, mode: "ask" as const, purpose: "voiceQuestion" as const };
    expect(routeTranscript("Wie lief die Woche?", q)).toEqual({
      to: "field",
      text: "Wie lief die Woche?",
      mode: "ask",
      auto: false,
    });
    expect(routeTranscript("Wie lief die Woche?", { ...q, sendVoiceImmediately: true })).toEqual({
      to: "ask",
      text: "Wie lief die Woche?",
    });
  });

  it("Sprachfrage that turns out to be a note: detection runs like on input (unless pinned)", () => {
    const q = { ...base, mode: "ask" as const, purpose: "voiceQuestion" as const };
    expect(routeTranscript("Milch kaufen", q)).toEqual({
      to: "field",
      text: "Milch kaufen",
      mode: "capture",
      auto: true,
    });
    expect(routeTranscript("Milch kaufen", { ...q, pinned: true })).toEqual({
      to: "field",
      text: "Milch kaufen",
      mode: "ask",
      auto: false,
    });
  });

  it("empty transcript: nothing", () => {
    expect(routeTranscript("  ", { ...base, purpose: "dictation" })).toBeNull();
  });

  it("purpose follows the mode at the tap", () => {
    expect(purposeFor("capture")).toBe("dictation");
    expect(purposeFor("ask")).toBe("voiceQuestion");
  });
});

describe("bar texts", () => {
  it("hint: Auto → Inbox / Link → Inbox / Auto → Antwort; pinned only the destination", () => {
    expect(barHint(typed("Idee: Preismodell"), "auto")).toBe("Auto → Inbox");
    expect(barHint(typed("Lesenswert https://example.com"), "auto")).toBe("Link → Inbox");
    expect(barHint(typed("Wie hängen Pricing und Retention zusammen?"), "auto")).toBe(
      "Auto → Antwort",
    );
    expect(barHint(typed("Idee", { pinned: true }), "auto")).toBe("→ Inbox");
    expect(barHint(typed(""), "auto")).toBeNull();
  });

  it("hint names a chip target other than Auto; Fragen ignores it", () => {
    expect(barHint(typed("Idee"), "journal")).toBe("Auto → Tagesnotiz");
    expect(barHint(typed("Steuer", { pinned: true }), "task")).toBe("→ Aufgabe");
    expect(barHint(typed("Wann ist das Meeting?"), "task")).toBe("Auto → Antwort");
  });

  it("recording hint (K9): speichert / übernimmt / sendet; push-to-talk says Loslassen", () => {
    const rec = { ...initialOrbitState(), recording: true };
    expect(recordingHint(rec, false)).toBe("Kortex hört zu · Orb tippen speichert");
    expect(recordingHint({ ...rec, mode: "ask" }, false)).toBe(
      "Kortex hört zu · Orb tippen übernimmt",
    );
    expect(recordingHint({ ...rec, mode: "ask", sendVoiceImmediately: true }, false)).toBe(
      "Kortex hört zu · Orb tippen sendet",
    );
    expect(recordingHint(rec, true)).toBe("Kortex hört zu · Loslassen speichert");
  });

  it("chip label", () => {
    expect(targetLabel("auto")).toBe("Inbox");
    expect(targetLabel("journal")).toBe("Tagesnotiz");
    expect(targetLabel("space", { label: "Rezepte", typeHint: "recipe" })).toBe("Rezepte");
    expect(targetLabel("space", null)).toBe("Aktueller Space");
  });
});

describe("planCapture: Ziel-Chip extras (Tactile Craft decision 9)", () => {
  it("#tags travel as structured tags, the text keeps them", () => {
    expect(planCapture("Pasta #rezept und #kochen/italienisch", "auto")).toEqual({
      to: "ingest",
      text: "Pasta #rezept und #kochen/italienisch",
      tags: ["rezept", "kochen/italienisch"],
    });
  });

  it("@Objekt of a known object becomes a wiki link", () => {
    expect(planCapture("Geschenkidee für @Lea Hoffmann: Buch", "auto", { objects: ["Lea Hoffmann", "Lea"] })).toEqual({
      to: "ingest",
      text: "Geschenkidee für [[Lea Hoffmann]]: Buch",
    });
  });

  it("Aktueller Space: folder (manual placement) or type of the space; without one it is Auto", () => {
    expect(planCapture("Idee", "space", { space: { label: "Projekte", folderPath: "10_Notes/Projekte" } })).toEqual({
      to: "ingest",
      text: "Idee",
      folderPath: "10_Notes/Projekte",
    });
    expect(planCapture("Pasta", "space", { space: { label: "Rezepte", typeHint: "recipe" } })).toEqual({
      to: "ingest",
      text: "Pasta",
      typeHint: "recipe",
    });
    expect(planCapture("Idee", "space", { space: null })).toEqual({ to: "ingest", text: "Idee" });
  });

  it("spaceContext: vault folders and single-type spaces only", () => {
    const spaces = [
      { key: "all", label: "Alle Einträge", types: null },
      { key: "recipes", label: "Rezepte", types: ["recipe"] },
      { key: "videos", label: "Videos & Podcasts", types: ["video", "podcast"] },
      { key: "notes", label: "Notizen", types: ["note", "daily_note"], hint: "note" },
      { key: "ai", label: "AI Memories", types: ["ai_chat"] },
    ];
    expect(spaceContext({ view: "spaces", doc: false, rest: ["notes"] }, spaces)).toEqual({ label: "Notizen", typeHint: "note" });
    expect(spaceContext({ view: "spaces", doc: false, rest: ["ai"] }, spaces)).toEqual({ label: "AI Memories", typeHint: "ai_chat" });
    expect(spaceContext({ view: "vault", doc: false, rest: ["10_Notes", "Projekte"] }, spaces)).toEqual({
      label: "Projekte",
      folderPath: "10_Notes/Projekte",
    });
    expect(spaceContext({ view: "vault", doc: true, rest: ["10_Notes", "a.md"] }, spaces)).toBeNull();
    expect(spaceContext({ view: "spaces", doc: false, rest: ["recipes"] }, spaces)).toEqual({ label: "Rezepte", typeHint: "recipe" });
    expect(spaceContext({ view: "spaces", doc: false, rest: ["videos"] }, spaces)).toBeNull();
    expect(spaceContext({ view: "spaces", doc: false, rest: ["all"] }, spaces)).toBeNull();
    expect(spaceContext({ view: "home", doc: false, rest: [] }, spaces)).toBeNull();
  });
});

describe("slash commands", () => {
  it("a bare / lists all; the prefix filters", () => {
    expect(filterCommands("/").map((c) => c.cmd)).toEqual(["/notiz", "/aufgabe", "/meeting", "/link", "/status", "/objekt", "/frage", "/briefing", "/recherche", "/aufräumen", "/entwurf", "/woche", "/akte"]);
    // Agent skills answer to both languages and map to a skill of the copilot.
    expect(parseCommand("/research Preise")?.command.id).toBe("recherche");
    expect(COMMAND_SKILL[parseCommand("/aufräumen")!.command.id]).toBe("tidy");
    expect(filterCommands("/no").map((c) => c.cmd)).toEqual(["/notiz"]);
    expect(filterCommands("/x")).toEqual([]);
    expect(filterCommands("Hallo /notiz")).toEqual([]);
  });

  it("command mode stays while the word is a known command with an argument", () => {
    expect(commandQuery("/aufgabe Steuer")).toBe("aufgabe");
    expect(commandQuery("/foo bar")).toBeNull();
    expect(commandQuery("Text")).toBeNull();
  });

  it("parseCommand: command and argument; unknown is null", () => {
    expect(parseCommand("/aufgabe  Steuer bis Freitag ")).toMatchObject({ command: { id: "aufgabe" }, arg: "Steuer bis Freitag" });
    expect(parseCommand("/NOTIZ")).toMatchObject({ command: { id: "notiz" }, arg: "" });
    expect(parseCommand("/foo")).toBeNull();
  });

  it("/objekt is listed but disabled (no object creation in the app yet); arrows skip it", () => {
    const list = filterCommands("/");
    const objekt = list.findIndex((c) => c.id === "objekt");
    expect(list[objekt]!.disabled).toBeTruthy();
    expect(nextEnabled(list, objekt - 1, 1)).toBe(objekt + 1);
    expect(nextEnabled(list, objekt + 1, -1)).toBe(objekt - 1);
    expect(nextEnabled(list, list.length - 1, 1)).toBe(0);
    expect(nextEnabled([{ disabled: "x" }], 0, 1)).toBe(-1);
  });
});

describe("@Objekte and #Tags", () => {
  it("detects the token before the caret", () => {
    expect(detectMention("Geschenkidee für @Le")).toEqual({ sig: "@", query: "le", start: 17, end: 20 });
    expect(detectMention("#pri")).toEqual({ sig: "#", query: "pri", start: 0, end: 4 });
    expect(detectMention("mail@example")).toBeNull();
    expect(detectMention("@Lea fertig ")).toBeNull();
    expect(detectMention("/notiz @x")).toBeNull();
    expect(detectMention("@Le und mehr", 3)).toEqual({ sig: "@", query: "le", start: 0, end: 3 });
  });

  it("applyMention replaces the token and puts the caret after it", () => {
    const m = detectMention("Geschenkidee für @Le")!;
    expect(applyMention("Geschenkidee für @Le", m, "@Lea Hoffmann")).toEqual({ text: "Geschenkidee für @Lea Hoffmann ", caret: 31 });
    const mid = detectMention("#pr später", 3)!;
    expect(applyMention("#pr später", mid, "#pricing")).toEqual({ text: "#pricing später", caret: 9 });
  });

  it("matchObjects: prefix hits first; matchTags: most used first", () => {
    const objs = [{ title: "Kortex Launch" }, { title: "Lea Hoffmann" }, { title: "Leadership" }];
    expect(matchObjects(objs, "le").map((o) => o.title)).toEqual(["Lea Hoffmann", "Leadership"]);
    expect(matchTags(["ai", "pricing", "ai", "privacy", "ai", "pricing"], "pri")).toEqual(["pricing", "privacy"]);
    expect(matchTags(["b", "a"], "")).toEqual(["a", "b"]);
    expect(matchTags(["#kortex", "kortex", "#ai/mcp"], "")).toEqual(["kortex", "ai/mcp"]);
  });

  it("extractTags and linkObjectMentions", () => {
    expect(extractTags("#a text #b/c #a #12 x#no #d-")).toEqual(["a", "b/c", "d"]);
    expect(linkObjectMentions("@Lea und @Lea Hoffmann, @Unbekannt", ["Lea", "Lea Hoffmann"])).toBe(
      "[[Lea]] und [[Lea Hoffmann]], @Unbekannt",
    );
  });
});

describe("link chip", () => {
  it("splits a leading URL from its note", () => {
    expect(splitLink("https://www.inkandswitch.com/local-first/")).toEqual({ url: "https://www.inkandswitch.com/local-first/", rest: "" });
    expect(splitLink("https://a.dev/x lesen #crdt")).toEqual({ url: "https://a.dev/x", rest: "lesen #crdt" });
    expect(splitLink("Lesen: https://a.dev")).toBeNull();
    expect(splitLink("https://")).toBeNull();
  });

  it("domain and clipboard URL", () => {
    expect(domainOf("https://www.inkandswitch.com/local-first/")).toBe("inkandswitch.com");
    expect(clipboardUrl(" https://automerge.org/blog/automerge-3/ ")).toBe("https://automerge.org/blog/automerge-3/");
    expect(clipboardUrl("kein link")).toBeNull();
    expect(clipboardUrl(null)).toBeNull();
  });
});

describe("keys and editor hand-off", () => {
  it("Enter sends, Shift/Ctrl/Cmd+Enter opens the editor", () => {
    const k = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false };
    expect(enterAction(k)).toBe("send");
    expect(enterAction({ ...k, shiftKey: true })).toBe("editor");
    expect(enterAction({ ...k, ctrlKey: true })).toBe("editor");
    expect(enterAction({ ...k, metaKey: true })).toBe("editor");
    expect(enterAction({ ...k, altKey: true })).toBeNull();
    expect(enterAction({ ...k, key: "a" })).toBeNull();
  });

  it("editorPrefill: short line = title, lines = title + body, prose = body", () => {
    expect(editorPrefill("Preismodell")).toEqual({ title: "Preismodell" });
    expect(editorPrefill("Titel\nZeile 1\nZeile 2")).toEqual({ title: "Titel", body: "Zeile 1\nZeile 2" });
    expect(editorPrefill("Ein ganzer Satz.")).toEqual({ body: "Ein ganzer Satz." });
    expect(editorPrefill("  ")).toEqual({});
  });
});

describe("Suchbereich (Fragen)", () => {
  const none = { itemId: null, folderPath: null };
  const full = { itemId: "0b8d7f3e-1d2c-4a5b-9c8d-7e6f5a4b3c2d", folderPath: "20_Meetings" };

  it("maps to the /api/chat scope; missing context falls back to the brain", () => {
    expect(scopeBody("all", full)).toEqual({ mode: "brain" });
    expect(scopeBody("note", full)).toEqual({ mode: "note", item_id: full.itemId });
    expect(scopeBody("space", full)).toEqual({ mode: "folder", folder_path: "20_Meetings" });
    expect(scopeBody("objects", none)).toEqual({ mode: "folder", folder_path: OBJECTS_FOLDER });
    expect(scopeBody("note", none)).toEqual({ mode: "brain" });
    expect(scopeBody("space", none)).toEqual({ mode: "brain" });
  });

  it("available and effective scope", () => {
    expect(availableScopes(none)).toEqual(["all", "objects"]);
    expect(availableScopes(full)).toEqual(["all", "space", "note", "objects"]);
    expect(effectiveScope("note", none, "all")).toBe("all");
    expect(effectiveScope(null, full, "note")).toBe("note");
    expect(effectiveScope("objects", none, "note")).toBe("objects");
  });
});

describe("focus quick actions and drop text", () => {
  it("clipboard link, last opened, question; without clipboard or recent only the question", () => {
    expect(
      focusSuggestions({ clipboard: "https://automerge.org/blog/automerge-3/", recent: { id: "n3", title: "AI_Engineering.pdf" } }),
    ).toEqual([
      { kind: "clipboard", label: "Aus Zwischenablage: automerge.org/blog", url: "https://automerge.org/blog/automerge-3/" },
      { kind: "continue", label: "Weiter mit AI_Engineering.pdf", id: "n3" },
      { kind: "ask", label: "Frage zu dieser Ansicht" },
    ]);
    expect(focusSuggestions({ clipboard: "Text", recent: null })).toEqual([{ kind: "ask", label: "Frage zu dieser Ansicht" }]);
  });

  it("drop label", () => {
    expect(dropLabel(3)).toBe("3 Dateien → Inbox");
    expect(dropLabel(1)).toBe("1 Datei → Inbox");
    expect(dropLabel(0)).toBe("→ Inbox");
  });
});
