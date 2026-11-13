import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import { SourceRegistry } from "../chat/agent";
import { createAgentHandlers } from "../chat/agent-handler";
import { createChatHandlers } from "../chat/handler";
import { FakeSupabase } from "./fake-supabase";
import { mockRouter, setup, USER_ID } from "./helpers";

const CHAT = "https://kortex.test/api/chat";
const AGENT = "https://kortex.test/api/chat/agent";
const MEETING_ID = "77777777-7777-4777-8777-777777777777";
const PERSON_ID = "88888888-8888-4888-8888-888888888888";
const TRANSCRIPT = "# Q4 Sync\n\n**Mayer:** Wir starten.\n\n**Lea:** Danke, Mayer.";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

/** Chat model that calls one tool per step in the given order, then answers with text. */
function agentModel(calls: Array<{ tool: string; input: unknown }>, answer = "Erledigt [1].") {
  let step = 0;
  const seen: string[][] = [];
  const model = new MockLanguageModelV4({
    modelId: "mock-chat",
    doStream: async (opts) => {
      seen.push(((opts as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => t.name));
      const call = calls[step++];
      const parts: unknown[] = call
        ? [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: `c${step}`, toolName: call.tool, input: JSON.stringify(call.input) },
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
  return { model, seen };
}

function make(chat: MockLanguageModelV4) {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: MEETING_ID,
        user_id: USER_ID,
        title: "Q4 Sync",
        type: "meeting",
        status: "processed",
        content_md: TRANSCRIPT,
        summary: null,
        folder_path: "20_Meetings",
        source_url: null,
        cluster_name: null,
        updated_at: "2026-11-11",
      },
    ],
    item_chunks: [],
    action_items: [],
    folders: [],
    user_settings: [{ user_id: USER_ID }],
  });
  db.authUser = { id: USER_ID };
  db.rpcHandlers.match_knowledge_hybrid = () => [
    {
      item_id: MEETING_ID,
      title: "Q4 Sync",
      type: "meeting",
      page_or_timestamp: null,
      folder_path: "20_Meetings",
      source_url: null,
      chunk_text: "Mayer: Wir starten.",
      summary: null,
    },
  ];
  const s = setup({ db, models: mockRouter({ chat }) });
  return { ...s, h: createChatHandlers(() => s.deps), a: createAgentHandlers(() => s.deps) };
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

const ask = (extra: Record<string, unknown> = {}) => ({
  mode: "brain",
  agent: true,
  messages: [{ role: "user", content: "Bereite mich auf das Gespräch mit Mayer vor" }],
  ...extra,
});

const tasks = (db: FakeSupabase) => db.tables.action_items as Array<{ id: string; title: string }>;
const meeting = (db: FakeSupabase) =>
  (db.tables.knowledge_items as Array<{ id: string; content_md: string; status: string }>).find((r) => r.id === MEETING_ID)!;

describe("SourceRegistry", () => {
  it("keeps numbers stable and numbers new sources after the existing ones", () => {
    const src = (id: string) => ({ item_id: id, title: id, type: "note", page_or_timestamp: null, folder_path: null, source_url: null, text: id });
    const reg = new SourceRegistry();
    expect(reg.add([src("a"), src("b")]).map((c) => c.n)).toEqual([1, 2]);
    expect(reg.add([src("b"), src("c")]).map((c) => c.n)).toEqual([2, 3]);
    expect(reg.get(3)?.item_id).toBe("c");
    expect(reg.list()).toHaveLength(3);
  });
});

describe("POST /api/chat as agent", () => {
  it("searches in steps and streams a step and the grown citations", async () => {
    const { model } = agentModel([{ tool: "vault_search", input: { query: "Mayer Entscheidungen" } }]);
    const { h } = make(model);
    const res = await h.POST(session(CHAT, ask()));
    expect(res.status).toBe(200);
    const parts = await readStream(res);
    const steps = parts.filter((p) => p.type === "data-step");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.data).toMatchObject({ kind: "search", label: "Mayer Entscheidungen", count: 1 });
    const cites = parts.filter((p) => p.type === "data-citations");
    expect(cites.length).toBeGreaterThanOrEqual(2);
    expect(cites.every((c) => c.id === "citations")).toBe(true);
  });

  it("offers no write tools when the agent may only read", async () => {
    const { model, seen } = agentModel([]);
    const { h } = make(model);
    await readStream(await h.POST(session(CHAT, ask({ autonomy: "read" }))));
    expect(seen[0]).toEqual(expect.arrayContaining(["vault_search", "vault_list", "note_read"]));
    expect(seen[0]).not.toContain("task_create");
    expect(seen[0]).not.toContain("note_create");
    expect(seen[0]).not.toContain("note_edit");
  });

  it("only proposes changes by default: nothing is saved, a data-proposal part lists them", async () => {
    const { model } = agentModel([
      { tool: "task_create", input: { title: "Mayer nach Budget fragen", source: 1 } },
      { tool: "note_edit", input: { source: 1, replacements: [{ find: "Mayer", replace: "Meier" }] } },
    ]);
    const { h, db } = make(model);
    const parts = await readStream(await h.POST(session(CHAT, ask())));
    expect(tasks(db)).toHaveLength(0);
    expect(meeting(db).content_md).toBe(TRANSCRIPT);
    const proposal = parts.filter((p) => p.type === "data-proposal").at(-1)!.data as {
      actions: Array<Record<string, unknown>>;
      labels: string[];
    };
    expect(proposal.actions).toHaveLength(2);
    expect(proposal.actions[0]).toMatchObject({ kind: "task_create", title: "Mayer nach Budget fragen", source_item_id: MEETING_ID });
    expect(proposal.actions[1]).toMatchObject({ kind: "note_edit", item_id: MEETING_ID, item_title: "Q4 Sync" });
    expect(proposal.labels[0]).toBe("Aufgabe „Mayer nach Budget fragen“ anlegen");
    expect(parts.some((p) => p.type === "data-done")).toBe(false);
  });

  it("makes changes at once when the agent works on its own, with what is needed to undo them", async () => {
    const { model } = agentModel([{ tool: "task_create", input: { title: "Mayer nach Budget fragen" } }]);
    const { h, db } = make(model);
    const parts = await readStream(await h.POST(session(CHAT, ask({ autonomy: "self" }))));
    expect(tasks(db).map((t) => t.title)).toEqual(["Mayer nach Budget fragen"]);
    const done = parts.filter((p) => p.type === "data-done").at(-1)!.data as { results: Array<Record<string, unknown>> };
    expect(done.results[0]).toMatchObject({ ok: true, undo: { kind: "task_create", task_id: tasks(db)[0]!.id } });
    expect(parts.some((p) => p.type === "data-proposal")).toBe(false);
  });
});

describe("dossier_update tool", () => {
  it("proposes the update of the open dossier with its title", async () => {
    const { model } = agentModel([
      { tool: "note_read", input: { source: 1 } },
      { tool: "dossier_update", input: { source: 1, state: "Neu.", open_points: ["A", "B"] } },
    ]);
    const { h, db } = make(model);
    const parts = await readStream(await h.POST(session(CHAT, ask({ skill: "dossier" }))));
    const proposal = parts.filter((p) => p.type === "data-proposal").at(-1)!.data as { actions: unknown[]; labels: string[] };
    expect(proposal.actions[0]).toMatchObject({ kind: "dossier_update", item_id: MEETING_ID, item_title: "Q4 Sync", state: "Neu.", open_points: ["A", "B"] });
    expect(proposal.labels[0]).toBe("Akte „Q4 Sync“ aktualisieren");
    expect(meeting(db).content_md).toBe(TRANSCRIPT);
  });
});

describe("POST /api/chat/agent", () => {
  it("carries out confirmed actions and takes them back", async () => {
    const { model } = agentModel([]);
    const { a, db } = make(model);
    const res = await a.POST(
      session(AGENT, {
        op: "execute",
        actions: [
          { kind: "task_create", title: "Angebot schicken" },
          { kind: "note_edit", item_id: MEETING_ID, replacements: [{ find: "Mayer", replace: "Meier" }] },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { results: Array<{ ok: boolean; undo?: unknown }>; edits: unknown[] };
    expect(out.results.map((r) => r.ok)).toEqual([true, true]);
    expect(out.edits).toHaveLength(1);
    expect(tasks(db)).toHaveLength(1);
    expect(meeting(db).content_md).toContain("**Meier:** Wir starten.");

    const undo = await a.POST(session(AGENT, { op: "undo", undo: out.results.map((r) => r.undo) }));
    expect(undo.status).toBe(200);
    expect(tasks(db)).toHaveLength(0);
    expect(meeting(db).content_md).toBe(TRANSCRIPT);
  });

  it("does not undo a task that already existed", async () => {
    const { model } = agentModel([]);
    const { a, db } = make(model);
    tasks(db).push({ id: "99999999-9999-4999-8999-999999999999", title: "Angebot schicken", user_id: USER_ID, status: "open" } as never);
    const res = await a.POST(session(AGENT, { op: "execute", actions: [{ kind: "task_create", title: "Angebot schicken" }] }));
    const out = (await res.json()) as { results: Array<{ ok: boolean; undo?: unknown }> };
    expect(out.results[0]).toMatchObject({ ok: true });
    expect(out.results[0]!.undo).toBeUndefined();
    expect(tasks(db)).toHaveLength(1);
  });

  it("updates a dossier: only the agent sections change, the user's notes stay, undo restores", async () => {
    const { model } = agentModel([]);
    const { a, db } = make(model);
    const before = "# Jonas Weber\n\n## Stand der Dinge\n\nAlt.\n\n## Eigene Notizen\n\nMag kurze Mails.\n";
    (db.tables.knowledge_items as unknown[]).push({ id: PERSON_ID, user_id: USER_ID, title: "Jonas Weber", type: "person", status: "processed", content_md: before, folder_path: "70_Objects/People" });
    const person = () => (db.tables.knowledge_items as Array<{ id: string; content_md: string }>).find((r) => r.id === PERSON_ID)!;
    const res = await a.POST(
      session(AGENT, { op: "execute", actions: [{ kind: "dossier_update", item_id: PERSON_ID, state: "Angebot liegt vor.", open_points: ["Staffelpreise nachreichen"] }] }),
    );
    const out = (await res.json()) as { results: Array<{ ok: boolean; label: string; undo?: unknown }>; edits: Array<{ content_md: string }> };
    expect(out.results[0]).toMatchObject({ ok: true, label: "Akte „Jonas Weber“ aktualisiert", undo: { kind: "note_edit", item_id: PERSON_ID, previous_md: before } });
    expect(person().content_md).toBe(
      "# Jonas Weber\n\n## Stand der Dinge\n\nAngebot liegt vor.\n\n## Offene Punkte\n\n- Staffelpreise nachreichen\n\n## Eigene Notizen\n\nMag kurze Mails.\n",
    );
    expect(out.edits[0]!.content_md).toBe(person().content_md);
    // Plain bullets: an open point is not turned into a task.
    expect(tasks(db)).toHaveLength(0);

    await a.POST(session(AGENT, { op: "undo", undo: [out.results[0]!.undo] }));
    expect(person().content_md).toBe(before);
  });

  it("refuses a dossier update on an entry that is no person, company or project", async () => {
    const { model } = agentModel([]);
    const { a, db } = make(model);
    const res = await a.POST(session(AGENT, { op: "execute", actions: [{ kind: "dossier_update", item_id: MEETING_ID, state: "Neu." }] }));
    const out = (await res.json()) as { results: Array<{ ok: boolean; error?: string }> };
    expect(out.results[0]!.ok).toBe(false);
    expect(meeting(db).content_md).toBe(TRANSCRIPT);
  });

  it("rejects an empty or malformed request", async () => {
    const { model } = agentModel([]);
    const { a } = make(model);
    expect((await a.POST(session(AGENT, { op: "execute", actions: [] }))).status).toBe(400);
    expect((await a.POST(session(AGENT, { op: "nope" }))).status).toBe(400);
  });
});
