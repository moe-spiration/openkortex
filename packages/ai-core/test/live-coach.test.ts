import { describe, expect, it } from "vitest";
import {
  buildCoachingPrompt,
  generateCoaching,
  parseCoachingBullets,
  streamCoaching,
} from "../src/coaching/live-coach";
import { parseMeetingTranscript } from "../src/audio/meeting-transcript";
import { createModelRouter } from "../src/router/model-router";
import { fakeFetch, mockModel, staticRouter } from "./helpers";
import { deepgramUtterances } from "./fixtures/meeting";

const snippets = [
  {
    title: "Vault-Sync Konflikte",
    type: "note",
    text: "Jede Datei trägt eine SHA-256 Checksum.",
    page_or_timestamp: null,
  },
  {
    title: "Q3 Review",
    type: "meeting",
    text: "Deepgram-Key war schon im Q3 ein Blocker.",
    page_or_timestamp: "00:41:10",
  },
];

const answer = `- **Fakten- & Kontext-Abgleich:** Der Deepgram-Key war schon im Q3 ein Blocker (Q3 Review).
- **Smarter Impuls / Rückfrage:** Wer genehmigt das Budget für die API-Keys?
- **Erkannte Entscheidung / Action Item:** Sven richtet die API-Keys bis Sonntag ein.`;

describe("buildCoachingPrompt", () => {
  it("uses spec prompt 5.2, the last N minutes and numbered Second-Brain snippets", () => {
    const { system, prompt, window } = buildCoachingPrompt({
      transcript: deepgramUtterances,
      windowMinutes: 2,
      snippets,
      openTasks: [
        { title: "SQL-Schema finalisieren", assignee: "Max", due_date: "2026-10-24T00:00:00Z" },
      ],
    });
    expect(system).toContain(
      "Du bist der Echtzeit-Meeting-Copilot für Ich.\n",
    );
    expect(system).toContain("Kanal 0 = Ich, Kanal 1 = Gesprächspartner");
    expect(system).toContain("maximal 3 kurzen Bullet-Points");
    expect(window.map((s) => s.startSec)).toEqual([72, 150]);
    expect(prompt).toContain("Transkript der letzten Minuten (00:01:12–00:02:40):");
    expect(prompt).toContain(
      "[00:02:30] Gesprächspartner 1: Ich richte die API-Keys bis Sonntag ein.",
    );
    expect(prompt).not.toContain("Sync-Logik durchgehen");
    expect(prompt).toContain(
      "[2] Q3 Review (meeting · 00:41:10)\nDeepgram-Key war schon im Q3 ein Blocker.",
    );
    expect(prompt).toContain("- SQL-Schema finalisieren (Max, fällig 2026-10-24)");
  });

  it("accepts already parsed segments and a custom name/role", () => {
    const segments = parseMeetingTranscript(deepgramUtterances, { self: "Anna" }).segments;
    const { system, prompt } = buildCoachingPrompt({
      transcript: segments,
      selfName: "Anna",
      selfRole: "CTO",
      untilSec: 15,
      windowMinutes: 1,
    });
    expect(system).toContain("für Anna (CTO)");
    expect(prompt).toContain("Anna: Lass uns die Sync-Logik durchgehen.");
    expect(prompt).toContain("(keine)");
  });
});

describe("coaching output", () => {
  it("parses at most 3 bullets", () => {
    expect(parseCoachingBullets(answer)).toEqual([
      "**Fakten- & Kontext-Abgleich:** Der Deepgram-Key war schon im Q3 ein Blocker (Q3 Review).",
      "**Smarter Impuls / Rückfrage:** Wer genehmigt das Budget für die API-Keys?",
      "**Erkannte Entscheidung / Action Item:** Sven richtet die API-Keys bis Sonntag ein.",
    ]);
    expect(parseCoachingBullets("1. a\nweiter\n2. b\n3. c\n4. d")).toEqual(["a weiter", "b", "c"]);
  });

  it("generateCoaching uses the meeting_coach route by default, another task on request", async () => {
    const coach = mockModel(answer);
    const fast = mockModel(answer);
    const models = staticRouter({ fast, tasks: { meeting_coach: coach } });
    const res = await generateCoaching({ transcript: deepgramUtterances, snippets }, { models });
    expect(res.bullets).toHaveLength(3);
    expect(coach.doGenerateCalls).toHaveLength(1);
    await generateCoaching(
      { transcript: deepgramUtterances, snippets },
      { models, task: "summarize" },
    );
    expect(fast.doGenerateCalls).toHaveLength(1);
  });

  it("streams through the OpenRouter router with data_collection: 'deny'", async () => {
    const chunk = (delta: Record<string, unknown>, finish: string | null = null, usage?: unknown) =>
      `data: ${JSON.stringify({
        id: "gen-1",
        object: "chat.completion.chunk",
        created: 1_760_000_000,
        model: "fx/coach-model",
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...(usage ? { usage } : {}),
      })}\n\n`;
    const sse = [
      chunk({ role: "assistant", content: "- **Fakten:** Q3-Blocker (Q3 Review)\n" }),
      chunk({ content: "- **Impuls:** Budget klären?" }),
      chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }),
      "data: [DONE]\n\n",
    ].join("");
    const fetch = fakeFetch([
      {
        match: (u) => u === "https://openrouter.ai/api/v1/chat/completions",
        respond: () => new Response(sse, { headers: { "content-type": "text/event-stream" } }),
      },
    ]);
    const models = createModelRouter({
      env: { OPENROUTER_API_KEY: "sk-or-test" },
      routing: { meeting_coach: { provider: "openrouter", model_id: "fx/coach-model" } },
      fetch,
    });
    const result = streamCoaching({ transcript: deepgramUtterances, snippets }, { models });
    let text = "";
    for await (const delta of result.textStream) text += delta;

    expect(parseCoachingBullets(text)).toEqual([
      "**Fakten:** Q3-Blocker (Q3 Review)",
      "**Impuls:** Budget klären?",
    ]);
    const body = fetch.calls[0]?.body as {
      model: string;
      stream: boolean;
      provider: { data_collection: string };
    };
    expect(body.provider.data_collection).toBe("deny");
    expect(body.model).toBe("fx/coach-model");
    expect(body.stream).toBe(true);
  });
});
