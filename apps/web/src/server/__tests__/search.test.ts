import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../auth/api-tokens/secret";
import { CONTENT_MAX_CHARS, createSearchHandlers, snippetOf } from "../search/handler";
import { FakeSupabase } from "./fake-supabase";
import { authed, NOW, OTHER_USER, setup, USER_ID } from "./helpers";

const URL_ = "https://kortex.test/api/search";
const PROMPT_ID = "77777777-7777-4777-8777-777777777777";

const hit = (over: Record<string, unknown> = {}) => ({
  item_id: "a1",
  title: "Vault-Sync Konflikte",
  type: "note",
  source_platform: "manual",
  summary: "SHA-256",
  chunk_text: "## Sync\nJede Datei trägt eine **SHA-256** Checksum.",
  page_or_timestamp: null,
  source_url: null,
  folder_path: "10_Notes",
  tags: ["kortex/sync"],
  cluster_name: "Kortex",
  combined_score: 0.032,
  ...over,
});

function make() {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: "a1",
        user_id: USER_ID,
        title: "Vault-Sync Konflikte",
        type: "note",
        content_md: "# Sync\nJede Datei trägt eine SHA-256 Checksum.",
        summary: null,
        folder_path: "10_Notes",
        source_url: null,
        tags: [],
        updated_at: "2026-10-20",
      },
      {
        id: PROMPT_ID,
        user_id: USER_ID,
        title: "Mail an {{name}}",
        type: "prompt",
        content_md: "Schreibe eine Mail an {{name}} über {{thema}}.",
        summary: null,
        folder_path: "40_AI_Memories/Prompts",
        source_url: null,
        tags: ["ai/prompt"],
        updated_at: "2026-10-22",
      },
      {
        id: "p-other",
        user_id: OTHER_USER,
        title: "Fremder Prompt",
        type: "prompt",
        content_md: "geheim",
        summary: null,
        folder_path: "40_AI_Memories/Prompts",
        source_url: null,
        tags: [],
        updated_at: "2026-10-23",
      },
    ],
  });
  db.authUser = { id: USER_ID };
  const s = setup({ db });
  db.rpcHandlers.match_knowledge_hybrid = () => [hit(), hit({ combined_score: 0.01 })];
  db.rpcHandlers.match_knowledge_hybrid_for_user = () => [
    hit({ item_id: PROMPT_ID, title: "Mail an {{name}}", type: "prompt" }),
  ];
  return { ...s, h: createSearchHandlers(() => s.deps) };
}

/** Session-cookie request (the web app). */
const session = (qs: string) =>
  new Request(`${URL_}${qs}`, { headers: { cookie: "sb-kortex-auth-token=x" } });

function seedToken(db: FakeSupabase, scopes: string[]) {
  const raw = generateToken();
  db.rows("api_tokens").push({
    id: `tok-${db.rows("api_tokens").length + 1}`,
    user_id: USER_ID,
    name: "Desktop",
    token_hash: hashToken(raw),
    token_prefix: raw.slice(0, 11),
    scopes,
    created_at: NOW.toISOString(),
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
  });
  return raw;
}

describe("GET /api/search", () => {
  it("runs the hybrid RPC as the signed-in user (with a query embedding) and returns one row per item", async () => {
    const { h, db, models } = make();
    const res = await h.GET(session("?q=Sync%20Konflikte&limit=5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, query: "Sync Konflikte", mode: "hybrid" });
    expect(body.results).toEqual([
      {
        item_id: "a1",
        title: "Vault-Sync Konflikte",
        type: "note",
        folder_path: "10_Notes",
        source_url: null,
        tags: ["kortex/sync"],
        snippet: "Sync Jede Datei trägt eine SHA-256 Checksum.",
        page_or_timestamp: null,
        score: 0.032,
      },
    ]);
    const call = db.rpcCalls.find((c) => c.name === "match_knowledge_hybrid");
    expect(call?.args).toMatchObject({ query_text: "Sync Konflikte", match_count: 5 });
    expect((call?.args as { query_embedding: string }).query_embedding).toMatch(/^\[0\.01,/);
    expect(models.embeddingModel.doEmbedCalls).toHaveLength(1);
    expect(db.rpcCalls.some((c) => c.name === "match_knowledge_hybrid_for_user")).toBe(false);
  });

  it("filters by type and adds content_md for the hits (prompt catalog)", async () => {
    const { h, db } = make();
    db.rpcHandlers.match_knowledge_hybrid = () => [
      hit({ item_id: PROMPT_ID, type: "prompt", title: "Mail an {{name}}" }),
    ];
    const res = await h.GET(session("?q=mail&type=prompt&content=1"));
    const body = await res.json();
    expect(db.rpcCalls.at(-1)?.args).toMatchObject({ filter_type: "prompt" });
    expect(body.results[0]).toMatchObject({
      item_id: PROMPT_ID,
      content_md: "Schreibe eine Mail an {{name}} über {{thema}}.",
    });
    const lookup = db.log.find(
      (q) => q.table === "knowledge_items" && q.filters.some((f) => f.op === "in"),
    );
    expect(lookup?.filters).toContainEqual({ col: "user_id", op: "eq", value: USER_ID });
  });

  it("lists the most recent items of a type for an empty query, only the caller's", async () => {
    const { h, db } = make();
    const res = await h.GET(session("?type=prompt&content=true"));
    const body = await res.json();
    expect(body.mode).toBe("recent");
    expect(body.results.map((r: { item_id: string }) => r.item_id)).toEqual([PROMPT_ID]);
    expect(body.results[0].content_md).toContain("{{thema}}");
    expect(db.rpcCalls.filter((c) => c.name.startsWith("match_"))).toHaveLength(0);
  });

  it("skips the embedding for short queries and with semantic=0 (full text only)", async () => {
    const { h, models } = make();
    const short = await (await h.GET(session("?q=ab"))).json();
    expect(short.mode).toBe("text");
    const plain = await (await h.GET(session("?q=Konflikte&semantic=0"))).json();
    expect(plain.mode).toBe("text");
    expect(models.embeddingModel.doEmbedCalls).toHaveLength(0);
  });

  it("falls back to full text when the query embedding fails", async () => {
    const { h, models, errors } = make();
    models.embeddingModel.doEmbed = async () => {
      throw new Error("embedding down");
    };
    const body = await (await h.GET(session("?q=Konflikte"))).json();
    expect(body.mode).toBe("text");
    expect(body.results).toHaveLength(1);
    expect(errors.some((e) => /embedding failed/.test(e.message))).toBe(true);
  });

  it("caps content_md", async () => {
    const { h, db } = make();
    db.rows("knowledge_items")[0]!.content_md = "x".repeat(CONTENT_MAX_CHARS + 500);
    const body = await (await h.GET(session("?q=Sync&content=1&semantic=0"))).json();
    expect(body.results[0].content_md).toHaveLength(CONTENT_MAX_CHARS);
  });

  it.each([
    ["an unknown type", "?q=x&type=nope"],
    ["a limit above 50", "?q=x&limit=51"],
    ["a too long query", `?q=${"x".repeat(501)}`],
  ])("rejects %s with 400", async (_n, qs) => {
    const { h } = make();
    const res = await h.GET(session(qs));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("requires authentication", async () => {
    const { h, db } = make();
    db.authUser = null;
    const res = await h.GET(new Request(`${URL_}?q=x`));
    expect(res.status).toBe(401);
  });

  it("uses the service-role variant with the owner's id for the owner-wide token", async () => {
    const { h, db, clientKinds } = make();
    const res = await h.GET(new Request(`${URL_}?q=mail&semantic=0`, authed()));
    expect(res.status).toBe(200);
    const call = db.rpcCalls.find((c) => c.name === "match_knowledge_hybrid_for_user");
    expect(call?.args).toMatchObject({ p_user_id: USER_ID, query_text: "mail" });
    expect(clientKinds).toContain("service");
  });

  it("accepts a personal kx_ token with the search scope", async () => {
    const { h, db } = make();
    const raw = seedToken(db, ["ingest", "search"]);
    const res = await h.GET(new Request(`${URL_}?q=mail&semantic=0`, authed({ token: raw })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].item_id).toBe(PROMPT_ID);
    expect(
      db.rpcCalls.find((c) => c.name === "match_knowledge_hybrid_for_user")?.args,
    ).toMatchObject({ p_user_id: USER_ID });
  });

  it("refuses a capture-only kx_ token (no read access without the search scope)", async () => {
    const { h, db } = make();
    const raw = seedToken(db, ["ingest"]);
    const res = await h.GET(new Request(`${URL_}?q=mail`, authed({ token: raw })));
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toMatch(/nicht verwendet/);
    expect(db.rpcCalls.some((c) => c.name.startsWith("match_"))).toBe(false);
  });
});

describe("snippetOf", () => {
  it("flattens Markdown to one line and cuts long passages", () => {
    expect(snippetOf("# Titel\n\n- **fett** und [Link](https://x.y)\n```js\ncode\n```\nEnde")).toBe(
      "Titel fett und Link Ende",
    );
    expect(snippetOf("a".repeat(400))).toHaveLength(280);
    expect(snippetOf(null)).toBe("");
  });
});
