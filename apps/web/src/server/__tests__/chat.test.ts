import { describe, expect, it } from "vitest";
import { createChatActionHandlers } from "../chat/action";
import { createChatHandlers } from "../chat/handler";
import { generateToken, hashToken } from "../auth/api-tokens/secret";
import { FakeSupabase } from "./fake-supabase";
import { authed, mockModel, mockRouter, OTHER_USER, postJson, setup, USER_ID } from "./helpers";

const CHAT = "https://kortex.test/api/chat";
const ACTION = "https://kortex.test/api/chat/action";
const NOTE_ID = "55555555-5555-4555-8555-555555555555";
const BOOK_ID = "66666666-6666-4666-8666-666666666666";

const hybridRows = [
  {
    item_id: "a1",
    title: "Vault-Sync Konflikte",
    type: "note",
    source_platform: "manual",
    summary: "SHA-256",
    chunk_text: "Jede Datei trägt eine SHA-256 Checksum.",
    page_or_timestamp: null,
    source_url: null,
    folder_path: "10_Notes",
    tags: [],
    cluster_name: "Kortex",
    combined_score: 0.9,
  },
  {
    item_id: "a2",
    title: "Q4 Architektur-Sync",
    type: "meeting",
    source_platform: "teams_wasapi",
    summary: null,
    chunk_text: "Max: Konflikte landen als .conflict.md.",
    page_or_timestamp: "00:12:40",
    source_url: null,
    folder_path: "20_Meetings",
    tags: [],
    cluster_name: "Automotive",
    combined_score: 0.7,
  },
  {
    item_id: "a1",
    title: "Vault-Sync Konflikte",
    type: "note",
    source_platform: "manual",
    summary: "SHA-256",
    chunk_text: "duplicate",
    page_or_timestamp: null,
    source_url: null,
    folder_path: "10_Notes",
    tags: [],
    cluster_name: "Kortex",
    combined_score: 0.5,
  },
];

function make() {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: NOTE_ID,
        user_id: USER_ID,
        title: "MCP Notiz",
        type: "note",
        content_md: "# MCP\nSechs Tools für Agenten.",
        summary: null,
        folder_path: "10_Notes",
        source_url: null,
        cluster_name: "Kortex",
        updated_at: "2026-10-22",
      },
      {
        id: BOOK_ID,
        user_id: USER_ID,
        title: "Wissensarbeit",
        type: "pdf",
        content_md: "x".repeat(25_000),
        summary: null,
        folder_path: "60_Documents",
        source_url: null,
        cluster_name: "Lesen",
        updated_at: "2026-10-21",
      },
    ],
    item_chunks: [
      {
        item_id: BOOK_ID,
        user_id: USER_ID,
        chunk_index: 0,
        chunk_heading: "Einleitung",
        page_or_timestamp: "Page 1",
        chunk_text: "Einleitung zum Buch.",
      },
      {
        item_id: BOOK_ID,
        user_id: USER_ID,
        chunk_index: 1,
        chunk_heading: "Zettelkasten",
        page_or_timestamp: "Page 42",
        chunk_text: "Der Zettelkasten von Luhmann verbindet Notizen.",
      },
      {
        item_id: BOOK_ID,
        user_id: USER_ID,
        chunk_index: 2,
        chunk_heading: "Fazit",
        page_or_timestamp: "Page 99",
        chunk_text: "Schluss.",
      },
    ],
    user_settings: [
      {
        user_id: USER_ID,
        preferred_chat_model: "anthropic/claude-3.7-sonnet",
        preferred_fast_model: "google/gemini-2.5-flash",
        embedding_model: "openai/text-embedding-3-small",
        auto_tag_enabled: true,
        auto_cluster_enabled: true,
      },
    ],
  });
  db.authUser = { id: USER_ID };
  db.rpcHandlers.match_knowledge_hybrid = () => hybridRows;
  const chat = mockModel(
    ["{}"],
    "Konflikte werden per Checksum erkannt [1] und als .conflict.md abgelegt [2].",
  );
  const s = setup({ db, models: mockRouter({ chat }) });
  return {
    ...s,
    chat,
    h: createChatHandlers(() => s.deps),
    a: createChatActionHandlers(() => s.deps),
  };
}

/** Session-cookie request (the web app). */
const session = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { cookie: "sb-kortex-auth-token=x", "content-type": "application/json" },
  });

/** Parses the SSE UI message stream into its JSON chunks. */
async function readStream(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}

const systemOf = (model: ReturnType<typeof mockModel>) =>
  JSON.stringify(model.doStreamCalls[0]?.prompt.filter((m) => m.role === "system"));

describe("POST /api/chat", () => {
  it("streams citations first, then the answer (whole-brain hybrid RAG)", async () => {
    const { h, db, chat, models } = make();
    const res = await h.POST(
      session(CHAT, {
        mode: "brain",
        messages: [{ role: "user", content: "Wie löse ich Sync-Konflikte?" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const chunks = await readStream(res);

    const citations = chunks.find((c) => c.type === "data-citations");
    expect(citations?.data).toEqual({
      mode: "brain",
      model: "mock/chat",
      citations: [
        {
          n: 1,
          item_id: "a1",
          title: "Vault-Sync Konflikte",
          type: "note",
          page_or_timestamp: null,
          folder_path: "10_Notes",
          source_url: null,
          snippet: "Jede Datei trägt eine SHA-256 Checksum.",
        },
        {
          n: 2,
          item_id: "a2",
          title: "Q4 Architektur-Sync",
          type: "meeting",
          page_or_timestamp: "00:12:40",
          folder_path: "20_Meetings",
          source_url: null,
          snippet: "Max: Konflikte landen als .conflict.md.",
        },
      ],
    });
    expect(chunks.indexOf(citations!)).toBeLessThan(
      chunks.findIndex((c) => c.type === "text-delta"),
    );
    const text = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta)
      .join("");
    expect(text).toBe(
      "Konflikte werden per Checksum erkannt [1] und als .conflict.md abgelegt [2].",
    );

    // Hybrid search got the question and a 1536-dim query embedding.
    const rpc = db.rpcCalls.find((c) => c.name === "match_knowledge_hybrid");
    expect(rpc?.args).toMatchObject({ query_text: "Wie löse ich Sync-Konflikte?", match_count: 8 });
    expect(
      String((rpc?.args as { query_embedding: string }).query_embedding).split(","),
    ).toHaveLength(1536);
    expect(models.embeddingModel.doEmbedCalls).toHaveLength(1);

    const system = systemOf(chat);
    expect(system).toContain("[1] Vault-Sync Konflikte (note)");
    expect(system).toContain("[2] Q4 Architektur-Sync (meeting · 00:12:40)");
    expect(system).toContain("Heute ist 2026-10-23");
    expect(system).toContain("Ordner: 10_Notes");
    // Not a routing question: no agents-guide excerpt in the prompt (G6b keeps it short).
    expect(system).not.toContain("Ablage-Wissen");
  });

  it("G6b: a routing question gets the vault structure and object folders from the agents guide", async () => {
    const { h, chat } = make();
    const res = await h.POST(
      session(CHAT, {
        mode: "brain",
        messages: [{ role: "user", content: "Wo lege ich eine neue Person ab?" }],
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const system = systemOf(chat);
    expect(system).toContain("Ablage-Wissen");
    expect(system).toContain("## Vault structure");
    expect(system).toContain("| `person` | `70_Objects/People` |");
    expect(system).toContain("`40_AI_Memories`");
    expect(system).not.toContain("## MCP tools");
  });

  it("switches the model from the request (through the router) and accepts useChat UI messages", async () => {
    const { h, modelRequests } = make();
    const res = await h.POST(
      session(CHAT, {
        mode: "brain",
        model: "openai/gpt-4o",
        messages: [
          { id: "1", role: "user", parts: [{ type: "text", text: "Hallo" }] },
          { id: "2", role: "assistant", parts: [{ type: "text", text: "Hi!" }] },
          {
            id: "3",
            role: "user",
            parts: [
              { type: "text", text: "Was ist " },
              { type: "text", text: "MCP?" },
            ],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    expect(modelRequests.at(-1)).toMatchObject({
      ai_routing_config: { chat_reasoning: { provider: "openrouter", model_id: "openai/gpt-4o" } },
    });
  });

  it("note mode sends the open note, without hybrid search", async () => {
    const { h, db, chat } = make();
    const chunks = await readStream(
      await h.POST(
        session(CHAT, {
          mode: "note",
          item_id: NOTE_ID,
          messages: [{ role: "user", content: "Fass zusammen" }],
        }),
      ),
    );
    const data = chunks.find((c) => c.type === "data-citations")?.data as { citations: unknown[] };
    expect(data.citations).toEqual([
      expect.objectContaining({
        n: 1,
        item_id: NOTE_ID,
        page_or_timestamp: null,
        snippet: "# MCP\nSechs Tools für Agenten.",
      }),
    ]);
    expect(db.rpcCalls.some((c) => c.name === "match_knowledge_hybrid")).toBe(false);
    expect(systemOf(chat)).toContain("die aktuell geöffnete Notiz");
  });

  it("note mode on a long document picks the relevant chunks with their pages", async () => {
    const { h } = make();
    const chunks = await readStream(
      await h.POST(
        session(CHAT, {
          mode: "note",
          item_id: BOOK_ID,
          match_count: 1,
          messages: [{ role: "user", content: "Was sagt Luhmann zum Zettelkasten?" }],
        }),
      ),
    );
    const data = chunks.find((c) => c.type === "data-citations")?.data as {
      citations: Array<{ page_or_timestamp: string }>;
    };
    expect(data.citations.map((c) => c.page_or_timestamp)).toEqual(["Page 42"]);
  });

  it("folder mode filters by folder path; cluster mode filters results by cluster", async () => {
    const { h, db } = make();
    await (
      await h.POST(
        session(CHAT, {
          mode: "folder",
          folder_path: "20_Meetings",
          messages: [{ role: "user", content: "x" }],
        }),
      )
    ).text();
    expect(db.rpcCalls.at(-1)?.args).toMatchObject({ filter_folder_path: "20_Meetings" });

    const chunks = await readStream(
      await h.POST(
        session(CHAT, {
          mode: "folder",
          cluster: "Automotive",
          messages: [{ role: "user", content: "x" }],
        }),
      ),
    );
    const data = chunks.find((c) => c.type === "data-citations")?.data as {
      citations: Array<{ item_id: string }>;
    };
    expect(data.citations.map((c) => c.item_id)).toEqual(["a2"]);

    // No hybrid hit in the cluster: falls back to the cluster's latest items.
    const fallback = await readStream(
      await h.POST(
        session(CHAT, {
          mode: "folder",
          cluster: "Lesen",
          messages: [{ role: "user", content: "x" }],
        }),
      ),
    );
    const fb = fallback.find((c) => c.type === "data-citations")?.data as {
      citations: Array<{ item_id: string }>;
    };
    expect(fb.citations.map((c) => c.item_id)).toEqual([BOOK_ID]);
  });

  it("falls back to full-text search when the query embedding fails", async () => {
    const { h, db, models, errors } = make();
    models.embeddingModel.doEmbed = async () => {
      throw new Error("embedding down");
    };
    const res = await h.POST(session(CHAT, { messages: [{ role: "user", content: "Konflikte" }] }));
    await res.text();
    expect(res.status).toBe(200);
    expect(db.rpcCalls.at(-1)?.args).toMatchObject({
      query_text: "Konflikte",
      query_embedding: null,
    });
    expect(errors[0]?.message).toMatch(/falling back to full-text/);
  });

  it("asks for a short answer with brief (desktop launcher)", async () => {
    const { h, chat } = make();
    const res = await h.POST(session(CHAT, { brief: true, messages: [{ role: "user", content: "Konflikte?" }] }));
    await res.text();
    expect(systemOf(chat)).toContain("Kurzantwort: höchstens drei Sätze");
    const plain = make();
    await (await plain.h.POST(session(CHAT, { messages: [{ role: "user", content: "Konflikte?" }] }))).text();
    expect(systemOf(plain.chat)).not.toContain("Kurzantwort");
  });

  it("validates requests", async () => {
    const { h } = make();
    const cases: Array<[unknown, RegExp]> = [
      [{ mode: "note", messages: [{ role: "user", content: "x" }] }, /^item_id: required/],
      [{ mode: "folder", messages: [{ role: "user", content: "x" }] }, /^folder_path:/],
      [{ model: "gpt-9", messages: [{ role: "user", content: "x" }] }, /^model:/],
      [{ messages: [{ role: "assistant", content: "x" }] }, /last message must be from the user/],
      [{ messages: [] }, /^messages:/],
    ];
    for (const [body, msg] of cases) {
      const res = await h.POST(session(CHAT, body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error.message).toMatch(msg);
    }
    const missing = await h.POST(
      session(CHAT, {
        mode: "note",
        item_id: "77777777-7777-4777-8777-777777777777",
        messages: [{ role: "user", content: "x" }],
      }),
    );
    expect(missing.status).toBe(404);
  });
});

describe("POST /api/chat with a personal API token (desktop launcher „Fragen“, S10)", () => {
  const OTHER_ITEM = "88888888-8888-4888-8888-888888888888";

  function withToken(scopes: string[]) {
    const t = make();
    t.db.rows("knowledge_items").push(
      { id: "a1", user_id: USER_ID, title: "Vault-Sync Konflikte", type: "note", content_md: "", folder_path: "10_Notes" },
      { id: "a2", user_id: USER_ID, title: "Q4 Architektur-Sync", type: "meeting", content_md: "", folder_path: "20_Meetings" },
      { id: OTHER_ITEM, user_id: OTHER_USER, title: "Gehaltsliste", type: "note", content_md: "geheim", folder_path: "10_Notes" },
    );
    // A per-user RPC that (wrongly) also returns another user's passage: it must never reach the answer.
    t.db.rpcHandlers.match_knowledge_hybrid_for_user = () => [
      ...hybridRows,
      { ...hybridRows[0]!, item_id: OTHER_ITEM, title: "Gehaltsliste", chunk_text: "geheim" },
    ];
    const raw = generateToken();
    t.db.rows("api_tokens").push({
      id: "tok-ask",
      user_id: USER_ID,
      name: "Desktop",
      token_hash: hashToken(raw),
      token_prefix: raw.slice(0, 11),
      scopes,
      created_at: "2026-10-01T00:00:00Z",
      last_used_at: null,
      expires_at: null,
      revoked_at: null,
    });
    return { ...t, raw };
  }
  const ask = (raw: string, url = CHAT) =>
    postJson(url, { mode: "brain", brief: true, messages: [{ role: "user", content: "Wie löse ich Sync-Konflikte?" }] }, { token: raw });

  it("answers as the token owner, searches only the owner's vault and drops foreign hits", async () => {
    const { h, db, raw, chat } = withToken(["ingest", "search", "ask"]);
    const res = await h.POST(ask(raw));
    expect(res.status).toBe(200);
    const chunks = await readStream(res);
    const citations = (chunks.find((c) => c.type === "data-citations")?.data as { citations: Array<{ item_id: string }> }).citations;
    expect(citations.map((c) => c.item_id)).toEqual(["a1", "a2"]);
    expect(JSON.stringify(chat.doStreamCalls[0]?.prompt)).not.toContain("geheim");
    const rpc = db.rpcCalls.find((c) => c.name === "match_knowledge_hybrid_for_user");
    expect(rpc?.args).toMatchObject({ p_user_id: USER_ID });
    expect(db.rpcCalls.some((c) => c.name === "match_knowledge_hybrid")).toBe(false);
  });

  it("never returns another user's items, even when every hit is foreign", async () => {
    const { h, db, raw } = withToken(["ingest", "ask"]);
    db.rpcHandlers.match_knowledge_hybrid_for_user = () => [{ ...hybridRows[0]!, item_id: OTHER_ITEM, title: "Gehaltsliste", chunk_text: "geheim" }];
    const chunks = await readStream(await h.POST(ask(raw)));
    expect((chunks.find((c) => c.type === "data-citations")?.data as { citations: unknown[] }).citations).toEqual([]);
    expect(JSON.stringify(chunks)).not.toContain("geheim");
  });

  it("refuses tokens without the ask scope and keeps /api/chat/action closed", async () => {
    const { h, raw } = withToken(["ingest", "search"]);
    expect((await h.POST(ask(raw))).status).toBe(401);
    const full = withToken(["ingest", "search", "ask"]);
    expect((await full.a.POST(postJson(ACTION, { action: "summarize", item_id: NOTE_ID }, { token: full.raw }))).status).toBe(403);
  });
});

describe("POST /api/chat/action", () => {
  it("summarize with save writes the TL;DR to the note", async () => {
    const { db } = make();
    const s = setup({
      db,
      models: mockRouter({ chat: mockModel(["Agenten bekommen sechs Tools."]) }),
    });
    const h = createChatActionHandlers(() => s.deps);
    const res = await (
      await h.POST(session(ACTION, { action: "summarize", item_id: NOTE_ID, save: true }))
    ).json();
    expect(res).toEqual({
      ok: true,
      action: "summarize",
      model: "mock/chat",
      content_md: "Agenten bekommen sechs Tools.",
      saved: true,
    });
    expect(db.rows("knowledge_items")[0]?.summary).toBe("Agenten bekommen sechs Tools.");
  });

  it("rewrite and outline return Markdown and never save", async () => {
    const db = new FakeSupabase();
    db.authUser = { id: USER_ID };
    const chat = mockModel(["## Neu\nBesser formuliert."]);
    const s = setup({ db, models: mockRouter({ chat }) });
    const h = createChatActionHandlers(() => s.deps);
    const res = await (
      await h.POST(
        session(ACTION, {
          action: "rewrite",
          content_md: "schlecht formuliert",
          instruction: "lockerer",
        }),
      )
    ).json();
    expect(res).toMatchObject({
      action: "rewrite",
      content_md: "## Neu\nBesser formuliert.",
      saved: false,
    });
    expect(JSON.stringify(chat.doGenerateCalls[0]?.prompt)).toContain(
      "Zusätzlicher Wunsch des Nutzers: lockerer",
    );
  });

  it("W8 editor KI: shorten and continue answer with Markdown for the selection, never save", async () => {
    const db = new FakeSupabase();
    db.authUser = { id: USER_ID };
    const chat = mockModel(["Kurz gefasst.", "Und so geht es weiter."]);
    const s = setup({ db, models: mockRouter({ chat }) });
    const h = createChatActionHandlers(() => s.deps);
    for (const [action, out, prompt] of [
      ["shorten", "Kurz gefasst.", "Kürze den folgenden Markdown-Text"],
      ["continue", "Und so geht es weiter.", "Setze den folgenden Text fort"],
    ] as const) {
      const res = await (
        await h.POST(session(ACTION, { action, content_md: "Ein längerer **Abschnitt**." }))
      ).json();
      expect(res).toMatchObject({ ok: true, action, content_md: out, saved: false });
      const call = chat.doGenerateCalls.at(-1);
      expect(JSON.stringify(call?.prompt)).toContain(prompt);
      expect(JSON.stringify(call?.prompt)).toContain("Ein längerer **Abschnitt**.");
    }
    expect(chat.doGenerateCalls.at(-1)?.temperature).toBe(0.7); // continue writes freely
  });

  it("flashcards with save stores them on the item", async () => {
    const db = new FakeSupabase({
      knowledge_items: [
        {
          id: NOTE_ID,
          user_id: USER_ID,
          title: "MCP",
          content_md: "MCP hat sechs Tools.",
          flashcards: [],
        },
      ],
    });
    db.authUser = { id: USER_ID };
    const cards = {
      flashcards: [
        { question: "Wie viele Tools hat MCP?", answer: "Sechs." },
        { question: " ", answer: "leer" },
      ],
    };
    const s = setup({ db, models: mockRouter({ chat: mockModel([cards]) }) });
    const res = await (
      await createChatActionHandlers(() => s.deps).POST(
        session(ACTION, { action: "flashcards", item_id: NOTE_ID, count: 5, save: true }),
      )
    ).json();
    expect(res).toEqual({
      ok: true,
      action: "flashcards",
      model: "mock/chat",
      flashcards: [{ question: "Wie viele Tools hat MCP?", answer: "Sechs." }],
      saved: true,
    });
    expect(db.rows("knowledge_items")[0]?.flashcards).toEqual([
      {
        question: "Wie viele Tools hat MCP?",
        answer: "Sechs.",
        created_at: "2026-10-23T08:00:00.000Z",
        source: "copilot",
      },
    ]);
  });

  it("tasks with save creates action items linked to the note", async () => {
    const db = new FakeSupabase({
      knowledge_items: [
        { id: NOTE_ID, user_id: USER_ID, title: "MCP", content_md: "Ich muss den Server testen." },
      ],
    });
    db.authUser = { id: USER_ID };
    const tasks = {
      action_items: [
        {
          title: "Server testen",
          description: null,
          assignee: "",
          priority: "urgent",
          due_date: "bald",
          source_timestamp_sec: null,
        },
      ],
    };
    const s = setup({ db, models: mockRouter({ chat: mockModel([tasks]) }) });
    const res = await (
      await createChatActionHandlers(() => s.deps).POST(
        session(ACTION, { action: "tasks", item_id: NOTE_ID, save: true }),
      )
    ).json();
    expect(res.action_items).toEqual([
      {
        title: "Server testen",
        description: null,
        assignee: "Me",
        priority: "urgent",
        due_date: null,
        source_timestamp_sec: null,
        project_item_id: null,
        project_title: null,
        timeframe: null,
        context: null,
      },
    ]);
    expect(db.rows("action_items")).toEqual([
      expect.objectContaining({
        title: "Server testen",
        user_id: USER_ID,
        source_item_id: NOTE_ID,
      }),
    ]);
  });

  it("validates input", async () => {
    const { a } = make();
    for (const body of [
      { action: "rewrite" },
      { action: "summarize", content_md: "x", save: true },
      { action: "dance", content_md: "x" },
    ]) {
      const res = await a.POST(session(ACTION, body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await a.POST(new Request(ACTION, authed({ method: "POST", body: "{}" })))).status).toBe(
      400,
    );
  });
});
