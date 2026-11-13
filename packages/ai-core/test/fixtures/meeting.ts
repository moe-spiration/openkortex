// Meeting transcripts in the formats the desktop app may send (handwritten, Deepgram-shaped).

/** Deepgram pre-recorded, multichannel + diarize + utterances. */
export const deepgramUtterances = {
  metadata: { request_id: "r1", created: "2026-10-21T10:00:00.000Z", duration: 185.5, channels: 2 },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript:
              "Lass uns die Sync-Logik durchgehen. Dann finalisiere ich bis Freitag das SQL-Schema.",
          },
        ],
      },
      {
        alternatives: [
          {
            transcript:
              "Gern, ich habe die Checksums geprüft. Von meiner Seite fehlt noch der Deepgram-Key.",
          },
        ],
      },
    ],
    utterances: [
      {
        channel: 0,
        start: 0.5,
        end: 4.2,
        transcript: "Lass uns die Sync-Logik durchgehen.",
        speaker: 0,
      },
      {
        channel: 1,
        start: 5.0,
        end: 9.8,
        transcript: "Gern, ich habe die Checksums geprüft.",
        speaker: 0,
      },
      {
        channel: 1,
        start: 10.1,
        end: 14.0,
        transcript: "Von meiner Seite fehlt noch der Deepgram-Key.",
        speaker: 1,
      },
      {
        channel: 0,
        start: 72.0,
        end: 80.0,
        transcript: "Dann finalisiere ich bis Freitag das SQL-Schema.",
        speaker: 0,
      },
      { channel: 0, start: 80.5, end: 83.0, transcript: "Und die RLS-Policies.", speaker: 0 },
      {
        channel: 1,
        start: 150.0,
        end: 160.0,
        transcript: "Ich richte die API-Keys bis Sonntag ein.",
        speaker: 0,
      },
    ],
  },
};

const w = (word: string, start: number, end: number, speaker?: number) => ({
  word: word.toLowerCase().replace(/[.,!?]/g, ""),
  punctuated_word: word,
  start,
  end,
  confidence: 0.99,
  ...(speaker !== undefined ? { speaker } : {}),
});

/** Deepgram pre-recorded without utterances: word timings per channel. */
export const deepgramWords = {
  metadata: { duration: 20 },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: "",
            words: [
              w("Hallo", 0, 0.4),
              w("zusammen.", 0.5, 1),
              w("Nächster", 8, 8.4),
              w("Punkt.", 8.5, 9),
            ],
          },
        ],
      },
      { alternatives: [{ transcript: "", words: [w("Hi", 2, 2.3, 0), w("Max!", 2.4, 2.8, 0)] }] },
    ],
  },
};

/** Live-stream `Results` messages as the HUD collects them (interim results are skipped). */
export const deepgramStream = [
  { type: "Metadata", request_id: "x" },
  {
    type: "Results",
    channel_index: [0, 2],
    start: 0,
    duration: 3,
    is_final: false,
    channel: { alternatives: [{ transcript: "Hallo zu" }] },
  },
  {
    type: "Results",
    channel_index: [0, 2],
    start: 0,
    duration: 3,
    is_final: true,
    channel: { alternatives: [{ transcript: "Hallo zusammen." }] },
  },
  {
    type: "Results",
    channel_index: [1, 2],
    start: 3.5,
    duration: 2,
    is_final: true,
    channel: { alternatives: [{ transcript: "Hi, wir können starten." }] },
  },
  {
    type: "Results",
    channel_index: [1, 2],
    start: 6,
    duration: 1,
    is_final: true,
    channel: { alternatives: [{ transcript: "" }] },
  },
];

/** Kortex normalized JSON (what the desktop app should send). */
export const kortexMeeting = {
  format: "kortex-meeting-v1",
  title: "Q4 Architektur-Sync",
  started_at: "2026-10-21T10:00:00.000Z",
  platform: "teams_wasapi",
  channel_names: ["Max", "Sven"],
  segments: [
    { channel: 0, start: 1, end: 4, text: "Wir nehmen MCP als Schnittstelle." },
    { channel: 1, start: 5, end: 8, text: "Einverstanden." },
    { channel: 1, start: 8.5, end: 10, text: "Ich kümmere mich um Deepgram." },
    { channel: 1, start: 12, end: 14, text: "Louisa sieht das auch so.", speaker: "Louisa" },
  ],
};

export const textTranscript = `[00:00:01] Max: Hallo zusammen.
[00:00:05] Sven: Hi Max, kurz zum Schema:
das ist fast fertig.
[00:01:00] [Kanal 1] Noch eine Frage zu RLS.
00:02:10 Max: Klären wir morgen.`;

export const protocolAnswer = {
  title: "Q4 Architektur-Sync: Agentic Workflows & MCP",
  executive_summary:
    "Das Team hat MCP als Schnittstelle beschlossen. Das SQL-Schema wird bis Freitag finalisiert.",
  topics: [
    { title: "Sync-Logik", summary: "Checksums wurden geprüft.", start_sec: 0 },
    { title: "Schema & Keys", summary: "Schema und API-Keys werden vorbereitet.", start_sec: 70 },
  ],
  decisions: ["MCP wird die Agenten-Schnittstelle."],
  risks: ["Deepgram-Key fehlt noch."],
  action_items: [
    {
      title: "SQL-Schema finalisieren",
      description: null,
      assignee: "Ich",
      priority: "high",
      due_date: "2026-10-24",
      source_timestamp_sec: 72,
    },
    {
      title: "API-Keys einrichten",
      description: "Deepgram + Groq",
      assignee: "Gesprächspartner 1",
      priority: "medium",
      due_date: "2026-10-26",
      source_timestamp_sec: 9999,
    },
  ],
};
