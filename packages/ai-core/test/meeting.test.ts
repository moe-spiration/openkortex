import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../src/adapters";
import { createMeetingAdapter, transcriptSections } from "../src/adapters/meeting.adapter";
import {
  lastMinutes,
  looksLikeMeetingTranscript,
  parseMeetingTranscript,
} from "../src/audio/meeting-transcript";
import { ExtractionError } from "../src/errors";
import { ingest } from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import {
  failingModel,
  ITEM_ID,
  mockEmbeddingModel,
  mockModel,
  staticRouter,
  USER_ID,
} from "./helpers";
import {
  deepgramStream,
  deepgramUtterances,
  deepgramWords,
  kortexMeeting,
  protocolAnswer,
  textTranscript,
} from "./fixtures/meeting";

const names = { self: "Max" };

describe("parseMeetingTranscript", () => {
  it("reads Deepgram utterances: channel 0 = self, diarized remote speakers are numbered", () => {
    const t = parseMeetingTranscript(JSON.stringify(deepgramUtterances), names);
    expect(t.format).toBe("deepgram");
    expect(t.durationSec).toBe(185.5);
    expect(t.startedAt).toBe("2026-10-21T10:00:00.000Z");
    expect(t.speakers).toEqual(["Max", "Gesprächspartner 1", "Gesprächspartner 2"]);
    expect(t.segments.map((s) => [s.channel, s.speaker, s.startSec, s.text])).toEqual([
      [0, "Max", 0.5, "Lass uns die Sync-Logik durchgehen."],
      [1, "Gesprächspartner 1", 5, "Gern, ich habe die Checksums geprüft."],
      [1, "Gesprächspartner 2", 10.1, "Von meiner Seite fehlt noch der Deepgram-Key."],
      // Back-to-back fragments of the same speaker are merged.
      [0, "Max", 72, "Dann finalisiere ich bis Freitag das SQL-Schema. Und die RLS-Policies."],
      [1, "Gesprächspartner 1", 150, "Ich richte die API-Keys bis Sonntag ein."],
    ]);
  });

  it("groups Deepgram word timings into turns", () => {
    const t = parseMeetingTranscript(deepgramWords, names);
    expect(t.segments.map((s) => [s.speaker, s.text])).toEqual([
      ["Max", "Hallo zusammen."],
      ["Gesprächspartner", "Hi Max!"],
      ["Max", "Nächster Punkt."],
    ]);
  });

  it("reads live-stream Results (finals only)", () => {
    const t = parseMeetingTranscript(deepgramStream);
    expect(t.format).toBe("deepgram_stream");
    expect(t.segments.map((s) => [s.speaker, s.startSec, s.text])).toEqual([
      ["Ich", 0, "Hallo zusammen."],
      ["Gesprächspartner", 3.5, "Hi, wir können starten."],
    ]);
  });

  it("reads the Kortex JSON with channel names and explicit speakers", () => {
    const t = parseMeetingTranscript(JSON.stringify(kortexMeeting));
    expect(t).toMatchObject({
      format: "kortex",
      title: "Q4 Architektur-Sync",
      platform: "teams_wasapi",
    });
    expect(t.speakers).toEqual(["Max", "Sven", "Louisa"]);
    expect(t.segments[1]?.text).toBe("Einverstanden. Ich kümmere mich um Deepgram.");
  });

  it("reads plain text lines, continuation lines and channel tags", () => {
    const t = parseMeetingTranscript(textTranscript, names);
    expect(t.format).toBe("text");
    expect(t.segments.map((s) => [s.channel, s.speaker, s.startSec, s.text])).toEqual([
      [0, "Max", 1, "Hallo zusammen."],
      [1, "Sven", 5, "Hi Max, kurz zum Schema: das ist fast fertig."],
      [1, "Gesprächspartner", 60, "Noch eine Frage zu RLS."],
      [0, "Max", 130, "Klären wir morgen."],
    ]);
  });

  it("rejects unknown or empty input and detects transcripts cheaply", () => {
    expect(() => parseMeetingTranscript({ foo: 1 })).toThrow(/unknown/);
    expect(() => parseMeetingTranscript({ format: "kortex-meeting-v1", segments: [] })).toThrow(
      /empty/,
    );
    expect(looksLikeMeetingTranscript(JSON.stringify(deepgramUtterances))).toBe(true);
    expect(looksLikeMeetingTranscript(JSON.stringify(kortexMeeting))).toBe(true);
    expect(looksLikeMeetingTranscript(JSON.stringify(deepgramStream))).toBe(true);
    expect(looksLikeMeetingTranscript('{"title":"x"}')).toBe(false);
    expect(looksLikeMeetingTranscript("[00:00:01] Max: hi")).toBe(false);
  });

  it("selects the last N minutes", () => {
    const t = parseMeetingTranscript(deepgramUtterances, names);
    expect(lastMinutes(t.segments, 2).map((s) => s.startSec)).toEqual([72, 150]);
    expect(lastMinutes(t.segments, 1, 15).map((s) => s.startSec)).toEqual([0.5, 5, 10.1]);
  });
});

describe("meeting adapter", () => {
  const input = {
    userId: USER_ID,
    typeHint: "meeting" as const,
    rawText: JSON.stringify(deepgramUtterances),
  };

  it("writes the executive protocol with timestamps and attributed action items", async () => {
    const chat = mockModel(protocolAnswer);
    const adapter = createMeetingAdapter({ models: staticRouter({ chat }), speakerNames: names });
    expect(adapter.canHandle(input)).toBe(true);
    const out = await adapter.extract(input);

    expect(out.type).toBe("meeting");
    expect(out.titleHint).toBe("Q4 Architektur-Sync: Agentic Workflows & MCP");
    const md = out.contentMd;
    expect(md).toMatch(
      /^# Q4 Architektur-Sync: Agentic Workflows & MCP\n\n> Meeting · 21\.10\.2026 · Dauer 00:03:05 · Teilnehmer: Max, Gesprächspartner 1, Gesprächspartner 2/,
    );
    const order = [
      "## Executive Summary",
      "## Besprochene Themenblöcke",
      "## Getroffene Entscheidungen",
      "## Offene Risiken & Blocker",
      "## Extrahierte Action Items",
      "> [!toggle]- Transkript",
    ];
    expect(order.map((h) => md.indexOf(h))).toEqual(
      [...order.map((h) => md.indexOf(h))].sort((a, b) => a - b),
    );
    expect(md).toContain("### 2. Schema & Keys [00:01:10]");
    expect(md).toContain("- [ ] @Max: SQL-Schema finalisieren (Due: 2026-10-24) · [00:01:12]");
    expect(md).toContain("- [ ] @Gesprächspartner 1: API-Keys einrichten (Due: 2026-10-26)\n");
    expect(md).toContain("[00:02:30] Gesprächspartner 1: Ich richte die API-Keys bis Sonntag ein.");

    expect(out.actionItems).toEqual([
      {
        title: "SQL-Schema finalisieren",
        description: null,
        assignee: "Max",
        priority: "high",
        due_date: "2026-10-24",
        source_timestamp_sec: 72,
        project_item_id: null,
        project_title: null,
        timeframe: null,
        context: null,
      },
      // A timestamp beyond the meeting length is dropped.
      {
        title: "API-Keys einrichten",
        description: "Deepgram + Groq",
        assignee: "Gesprächspartner 1",
        priority: "medium",
        due_date: "2026-10-26",
        source_timestamp_sec: null,
        project_item_id: null,
        project_title: null,
        timeframe: null,
        context: null,
      },
    ]);
    expect(out.structuralChunks?.map((c) => [c.heading, c.pageOrTimestamp])).toEqual([
      ["Protokoll", undefined],
      ["Sync-Logik", "00:00:00"],
      ["Schema & Keys", "00:01:10"],
    ]);
    expect(out.metadata).toMatchObject({
      duration_sec: 186,
      participants: ["Max", "Gesprächspartner 1", "Gesprächspartner 2"],
      channels: [0, 1],
      transcript_format: "deepgram",
      decisions: ["MCP wird die Agenten-Schnittstelle."],
      protocol_model: "mock/chat",
    });

    const prompt = JSON.stringify(chat.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Kanal 0 ist der Nutzer (Max)");
    expect(prompt).toContain("[00:01:12] Max: Dann finalisiere ich");
  });

  it("keeps the full transcript when the model fails (or is not configured)", async () => {
    for (const models of [staticRouter({ chat: failingModel() }), undefined]) {
      const out = await createMeetingAdapter({
        models,
        now: () => new Date("2026-10-23T08:00:00Z"),
      }).extract({
        userId: USER_ID,
        typeHint: "meeting",
        rawText: textTranscript,
      });
      expect(out.titleHint).toBe("Meeting 23.10.2026");
      expect(out.contentMd).toContain("> Protokoll konnte nicht erstellt werden");
      expect(out.contentMd).toContain("[00:02:10] Max: Klären wir morgen.");
      expect(out.actionItems).toBeUndefined();
      expect(out.structuralChunks?.[0]?.pageOrTimestamp).toBe("00:00:00");
    }
  });

  it("accepts uploaded JSON transcripts and rejects garbage", async () => {
    const adapter = createMeetingAdapter();
    const file = {
      userId: USER_ID,
      fileBuffer: new TextEncoder().encode(JSON.stringify(kortexMeeting)),
      fileName: "meeting.json",
      mimeType: "application/json",
    };
    expect(adapter.canHandle(file)).toBe(true);
    expect((await adapter.extract(file)).titleHint).toBe("Q4 Architektur-Sync");
    expect(
      adapter.canHandle({
        userId: USER_ID,
        fileBuffer: new TextEncoder().encode('{"a":1}'),
        fileName: "x.json",
      }),
    ).toBe(false);
    await expect(
      adapter.extract({ userId: USER_ID, typeHint: "meeting", rawText: '{"foo":1}' }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it("splits transcripts into 5-minute windows without topics", () => {
    const t = parseMeetingTranscript({
      format: "kortex-meeting-v1",
      segments: [
        { channel: 0, start: 10, text: "a" },
        { channel: 1, start: 620, text: "b" },
      ],
    });
    expect(transcriptSections(t.segments, []).map((s) => [s.title, s.startSec])).toEqual([
      ["Abschnitt 00:00:00", 0],
      ["Abschnitt 00:10:00", 600],
    ]);
    expect(
      transcriptSections(t.segments, [{ title: "Später", start_sec: 300 }]).map((s) => s.title),
    ).toEqual(["Einstieg", "Später"]);
  });
});

describe("meeting through ingest()", () => {
  it("routes typeHint 'meeting', and the protocol's timestamped tasks win over the organizer's", async () => {
    const organizerAnswer = {
      title: "Org-Titel",
      summary: "Kurz.",
      cluster_name: "Kortex",
      suggested_folder_path: "20_Meetings",
      tags: ["meetings/q4"],
      entities: [],
      action_items: [
        {
          title: "Duplikat ohne Zeit",
          description: null,
          assignee: "Me",
          priority: "low",
          due_date: null,
          source_timestamp_sec: null,
        },
      ],
    };
    // meeting_coach writes the protocol, auto_organize runs the organizer (ADR-06 routes).
    const models = staticRouter({
      tasks: {
        meeting_coach: mockModel(protocolAnswer),
        auto_organize: mockModel(organizerAnswer),
      },
      embedding: mockEmbeddingModel(),
    });
    const registry = createDefaultRegistry({
      storage: createMemoryStorageGateway(),
      models,
      meeting: { speakerNames: names },
    });
    const res = await ingest(
      { userId: USER_ID, typeHint: "meeting", rawText: JSON.stringify(deepgramUtterances) },
      { existingTags: [], existingClusters: [], existingObjects: [] },
      { registry, models, generateId: () => ITEM_ID },
    );
    expect(res.adapterId).toBe("meeting");
    expect(res.item).toMatchObject({ type: "meeting", folder_path: "20_Meetings", icon: "mic" });
    expect(res.actionItems.map((a) => [a.title, a.source_timestamp_sec, a.source_item_id])).toEqual(
      [
        ["SQL-Schema finalisieren", 72, ITEM_ID],
        ["API-Keys einrichten", null, ITEM_ID],
      ],
    );
    expect(res.chunks.map((c) => c.page_or_timestamp)).toContain("00:01:10");
  });
});
