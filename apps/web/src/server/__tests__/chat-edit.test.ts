import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import { createChatActionHandlers } from "../chat/action";
import { createChatHandlers } from "../chat/handler";
import { applyReplacements } from "../chat/edit";
import { wantsEdit } from "../chat/edit";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, setup, USER_ID } from "./helpers";

const CHAT = "https://kortex.test/api/chat";
const ACTION = "https://kortex.test/api/chat/action";
const MEETING_ID = "77777777-7777-4777-8777-777777777777";
const TRANSCRIPT =
  "# Q4 Sync\n\n**Mayer:** Wir starten.\n\n**Lea:** Danke, Mayer. Herr Mayers Plan steht.\n\nMayerhofer bleibt.";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

/** Chat model whose first step calls a tool and whose second step answers with text. */
function toolModel(toolName: string, input: unknown, answer = "Erledigt.") {
  let step = 0;
  return new MockLanguageModelV4({
    modelId: "mock-chat",
    doStream: async () => {
      const first = step++ === 0;
      // The two steps' parts differ in shape; the mock's stream part type is wider than both.
      const parts: unknown[] = first
        ? [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "c1", toolName, input: JSON.stringify(input) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: answer },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ];
      return { stream: convertArrayToReadableStream(parts as never[]) };
    },
  });
}

function make(chat: MockLanguageModelV4) {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: MEETING_ID,
        user_id: USER_ID,
        title: "Q4 Sync",
        type: "meeting",
        content_md: TRANSCRIPT,
        summary: null,
        folder_path: "20_Meetings",
        source_url: null,
        cluster_name: null,
        updated_at: "2026-11-11",
      },
    ],
    item_chunks: [],
    user_settings: [{ user_id: USER_ID }],
  });
  db.authUser = { id: USER_ID };
  db.rpcHandlers.match_knowledge_hybrid = () => [];
  const s = setup({ db, models: mockRouter({ chat }) });
  return { ...s, h: createChatHandlers(() => s.deps), a: createChatActionHandlers(() => s.deps) };
}

const session = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { cookie: "sb-kortex-auth-token=x", "content-type": "application/json" },
  });

async function readStream(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}

const body = (db: FakeSupabase) =>
  (db.tables.knowledge_items as Array<{ id: string; content_md: string; title: string }>).find(
    (r) => r.id === MEETING_ID,
  )!;

describe("applyReplacements", () => {
  it("replaces whole words only by default, all occurrences, and counts them", () => {
    const { content, results } = applyReplacements(TRANSCRIPT, [
      { find: "Mayer", replace: "Meier" },
    ]);
    expect(content).toContain("**Meier:** Wir starten.");
    expect(content).toContain("Danke, Meier.");
    expect(content).toContain("Herr Mayers Plan"); // not a whole word
    expect(content).toContain("Mayerhofer bleibt.");
    expect(results).toEqual([{ find: "Mayer", replace: "Meier", count: 2 }]);
  });

  it("can match inside words and ignore case", () => {
    const { content, results } = applyReplacements("mayer Mayers", [
      { find: "mayer", replace: "Meier", whole_word: false, case_sensitive: false },
    ]);
    expect(content).toBe("Meier Meiers");
    expect(results[0]!.count).toBe(2);
  });

  it("treats regex characters literally", () => {
    expect(applyReplacements("a (b) a.b", [{ find: "(b)", replace: "[c]" }]).content).toBe(
      "a [c] a.b",
    );
  });
});

describe("wantsEdit", () => {
  it("detects change requests, not plain questions", () => {
    expect(wantsEdit(["Ersetze im Transkript Mayer durch Meier"])).toBe(true);
    expect(wantsEdit(["Korrigiere die Namen bitte"])).toBe(true);
    expect(wantsEdit(["Was wurde im Q4 Sync beschlossen?"])).toBe(false);
  });
});

describe("POST /api/chat edits an existing entry (note_edit)", () => {
  it("replaces names in the open note, saves it and streams a data-edit part", async () => {
    const chat = toolModel(
      "note_edit",
      { replacements: [{ find: "Mayer", replace: "Meier" }] },
      "2 Stellen korrigiert.",
    );
    const { h, db } = make(chat);
    const res = await h.POST(
      session(CHAT, {
        mode: "brain",
        item_id: MEETING_ID,
        messages: [{ role: "user", content: "Ersetze im Transkript Mayer durch Meier" }],
      }),
    );
    expect(res.status).toBe(200);
    const chunks = await readStream(res);
    const edit = chunks.find((c) => c.type === "data-edit") as
      { data: Record<string, unknown> } | undefined;
    expect(edit?.data).toMatchObject({
      item_id: MEETING_ID,
      title: "Q4 Sync",
      replacements: [{ find: "Mayer", replace: "Meier", count: 2 }],
    });
    expect(body(db).content_md).toContain("**Meier:** Wir starten.");
    expect(body(db).content_md).toContain("Mayerhofer bleibt.");
    const text = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta)
      .join("");
    expect(text).toBe("2 Stellen korrigiert.");
    // The model got the tools and the edit rules.
    const call = chat.doStreamCalls[0]!;
    expect(call.tools?.map((t) => t.name).sort()).toEqual(["note_edit", "note_read"]);
  });

  it("saves nothing when the text is not found and tells the model to read the note", async () => {
    const chat = toolModel("note_edit", {
      replacements: [{ find: "Schmidt", replace: "Schmitt" }],
    });
    const { h, db } = make(chat);
    const res = await h.POST(
      session(CHAT, {
        mode: "note",
        item_id: MEETING_ID,
        messages: [{ role: "user", content: "Korrigiere Schmidt zu Schmitt" }],
      }),
    );
    const chunks = await readStream(res);
    expect(chunks.some((c) => c.type === "data-edit")).toBe(false);
    expect(body(db).content_md).toBe(TRANSCRIPT);
    const second = JSON.stringify(chat.doStreamCalls[1]?.prompt);
    expect(second).toContain("Kein Treffer");
  });

  it("offers no tools for a plain question", async () => {
    const chat = mockModel(["{}"], "Antwort.");
    const { h } = make(chat);
    await readStream(
      await h.POST(
        session(CHAT, {
          mode: "note",
          item_id: MEETING_ID,
          messages: [{ role: "user", content: "Worum ging es im Meeting?" }],
        }),
      ),
    );
    expect(chat.doStreamCalls[0]?.tools ?? []).toEqual([]);
  });
});

describe("POST /api/chat/action custom (Eigene Anweisung)", () => {
  it("sends the user's instruction with the selection and returns Markdown", async () => {
    const chat = mockModel(["Danke, Meier."]);
    const { a } = make(chat);
    const res = await a.POST(
      session(ACTION, {
        action: "custom",
        item_id: MEETING_ID,
        content_md: "Danke, Mayer.",
        instruction: "Ersetze Mayer durch Meier",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      action: "custom",
      content_md: "Danke, Meier.",
    });
    const system = JSON.stringify(
      chat.doGenerateCalls[0]?.prompt.filter((m) => m.role === "system"),
    );
    expect(system).toContain("Anweisung des Nutzers: Ersetze Mayer durch Meier");
  });

  it("refuses custom without an instruction", async () => {
    const { a } = make(mockModel());
    const res = await a.POST(session(ACTION, { action: "custom", content_md: "x" }));
    expect(res.status).toBe(400);
  });
});
