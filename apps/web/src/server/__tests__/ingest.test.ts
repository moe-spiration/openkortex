import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createIngestHandlers } from "../ingest/handler";
import { memoryFileName, normalizeUrl } from "../ingest/service";
import { FakeSupabase, type QueryLog } from "./fake-supabase";
import {
  API_TOKEN,
  authed,
  fakeFetch,
  json,
  mockModel,
  mockRouter,
  postJson,
  seedFolders,
  setup,
  USER_ID,
} from "./helpers";

// The extension client is loaded by path (non-literal import) so the web typecheck does not
// follow it into the extension code that uses chrome.* types.
interface ExtensionApi {
  memoryFileName(title: string, at: Date): string;
  clientInfo(version: string): { name: "kortex-extension"; version: string };
  createApiClient(deps: {
    getSettings: () => Promise<unknown>;
    fetchImpl?: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
  }): { ingest(req: unknown): Promise<{ ok: boolean; [key: string]: unknown }> };
}
const EXTENSION_API = fileURLToPath(
  new URL("../../../../extension/src/lib/api.ts", import.meta.url),
);
const loadExtensionApi = () => import(/* @vite-ignore */ EXTENSION_API) as Promise<ExtensionApi>;

const ARTICLE_URL = "https://www.heise.de/hintergrund/mcp-erklaert-1234.html";
const BASE = "https://kortex.test/api/ingest";

const enrichment = {
  title: "MCP für Second Brains",
  summary: "MCP öffnet Wissen für Agenten.",
  cluster_name: "AI & Engineering",
  suggested_folder_path: "30_Clippings/AI",
  tags: ["ai/mcp"],
  entities: [{ name: "Supabase", type: "tool" }],
  action_items: [
    {
      title: "MCP-Server testen",
      description: null,
      assignee: "Me",
      priority: "high",
      due_date: "2026-10-30",
      source_timestamp_sec: null,
    },
  ],
};

const jina = fakeFetch([
  {
    match: (u) => u.startsWith("https://r.jina.ai/"),
    respond: () =>
      json({
        data: {
          title: "MCP erklärt",
          url: ARTICLE_URL,
          content: `# MCP erklärt\n\n${"Das Model Context Protocol verbindet Agenten mit Werkzeugen. ".repeat(20)}`,
        },
      }),
  },
]);

function make(opts: Parameters<typeof setup>[0] = {}) {
  const db = opts.db ?? new FakeSupabase();
  seedFolders(db);
  const s = setup({
    fetch: jina,
    models: mockRouter({ fast: mockModel([enrichment]) }),
    ...opts,
    db,
  });
  const h = createIngestHandlers(() => s.deps);
  return { ...s, h };
}

const webClip = (over: Record<string, unknown> = {}) => ({
  kind: "web_clip",
  client: { name: "kortex-extension", version: "0.1.0" },
  captured_at: "2026-10-23T07:59:00.000Z",
  url: ARTICLE_URL,
  title: "MCP erklärt – heise",
  tags: ["AI/MCP", "lesen"],
  ...over,
});

/** Every query against a user table is scoped to the caller (service-role path relies on it). */
function expectUserScoped(log: QueryLog[], userId = USER_ID) {
  for (const q of log) {
    if (q.op === "insert" || q.op === "upsert") {
      for (const row of q.payload as Array<Record<string, unknown>>)
        expect(row.user_id, `${q.op} ${q.table}`).toBe(userId);
    } else {
      expect(q.filters, `${q.op} ${q.table}`).toContainEqual({
        col: "user_id",
        op: "eq",
        value: userId,
      });
    }
  }
}

describe("auth", () => {
  it("rejects requests without credentials with the shared error shape", async () => {
    const { h } = make();
    const res = await h.POST(new Request(BASE, { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "unauthorized", message: "Nicht angemeldet" },
    });
  });

  it("rejects a wrong bearer token", async () => {
    const { h } = make();
    const res = await h.GET(new Request(BASE, authed({ token: "nope" })));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("accepts the API token (service role, scoped to KORTEX_API_TOKEN_USER_ID) and bootstraps once", async () => {
    const { h, db, clientKinds } = make();
    for (let i = 0; i < 2; i++) {
      const res = await h.GET(new Request(BASE, authed()));
      expect(await res.json()).toEqual({ ok: true, user_id: USER_ID });
    }
    expect(clientKinds).toEqual(["service", "service"]);
    expect(db.rpcCalls).toEqual([
      { name: "_bootstrap_user", args: { p_user_id: USER_ID }, userJwt: true },
    ]);
  });

  it("accepts a Supabase JWT and a cookie session (RLS clients, bootstrap_user())", async () => {
    const { h, db, clientKinds } = make();
    db.authUser = { id: "33333333-3333-4333-8333-333333333333" };
    db.rows("allowed_users").push({
      user_id: "33333333-3333-4333-8333-333333333333",
      role: "member",
    });
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIzMyJ9.c2ln";
    const a = await (await h.GET(new Request(BASE, authed({ token: jwt })))).json();
    const b = await (
      await h.GET(new Request(BASE, { headers: { cookie: "sb-x-auth-token=abc" } }))
    ).json();
    expect(a.user_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(b.user_id).toBe(a.user_id);
    expect(clientKinds).toEqual(["jwt", "session"]);
    // S2a: allowlist check (cached per user), then the one-time bootstrap.
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["is_allowed", "bootstrap_user"]);
  });

  it("reports missing Supabase config as not_configured (503), placeholders count as missing", async () => {
    const { createSupabaseClients } = await import("../supabase");
    const { readServerEnv } = await import("../env");
    const env = readServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: "<DEINE_SUPABASE_PROJECT_URL>",
      KORTEX_API_TOKEN: API_TOKEN,
      KORTEX_API_TOKEN_USER_ID: USER_ID,
    });
    const s = setup();
    const h = createIngestHandlers(() => ({ ...s.deps, env, clients: createSupabaseClients(env) }));
    const res = await h.GET(new Request(BASE, authed()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "not_configured", message: "NEXT_PUBLIC_SUPABASE_URL ist nicht gesetzt" },
    });
  });
});

describe("POST /api/ingest web_clip", () => {
  it("answers immediately with an optimistic inbox item, then the queued pipeline fills it in", async () => {
    const { h, db, deferred, drain, errors } = make();
    const res = await h.POST(postJson(BASE, webClip({ note: "Für das MCP-Kapitel" })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      kind: "web_clip",
      item_id: "22222222-2222-4222-8222-000000000001",
      type: "bookmark",
      status: "inbox",
      folder_path: "00_Inbox",
      auto_routed: true,
      duplicate: false,
      queued: true,
      suggested_tags: ["ai/mcp", "lesen"],
    });
    expect(deferred).toHaveLength(1);
    const optimistic = db.rows("knowledge_items")[0];
    expect(optimistic).toMatchObject({
      status: "inbox",
      folder_id: "f-00_Inbox",
      is_manual_placement: false,
      source_url: ARTICLE_URL,
    });

    await drain();
    expect(errors).toEqual([]);
    const item = db.rows("knowledge_items")[0] as Record<string, unknown>;
    expect(item).toMatchObject({
      id: body.item_id,
      user_id: USER_ID,
      type: "article",
      status: "processed",
      title: "MCP für Second Brains",
      summary: "MCP öffnet Wissen für Agenten.",
      cluster_name: "AI & Engineering",
      folder_path: "30_Clippings/AI",
      is_manual_placement: false,
      source_url: ARTICLE_URL,
      tags: ["ai/mcp", "lesen"],
    });
    expect(String(item.content_md).startsWith("Für das MCP-Kapitel\n\n---\n\n# MCP erklärt")).toBe(
      true,
    );
    expect((item.metadata as Record<string, unknown>).ingest).toMatchObject({
      state: "done",
      adapter: "web-article",
    });

    // AI sub-folder created under the existing system folder.
    const sub = db.rows("folders").find((f) => f.folder_path === "30_Clippings/AI");
    expect(sub).toMatchObject({ parent_id: "f-30_Clippings", name: "AI" });
    expect(item.folder_id).toBe(sub?.id);

    expect(db.rows("item_chunks").length).toBeGreaterThan(0);
    expect(
      db
        .rows("item_chunks")
        .every((c) => c.item_id === body.item_id && String(c.embedding).startsWith("[0.01,")),
    ).toBe(true);
    expect(db.rows("action_items")).toEqual([
      expect.objectContaining({
        title: "MCP-Server testen",
        source_item_id: body.item_id,
        priority: "high",
        user_id: USER_ID,
      }),
    ]);
    expect(db.rows("tags").map((t) => [t.name, t.usage_count])).toEqual([
      ["ai/mcp", 1],
      ["lesen", 1],
    ]);
    expectUserScoped(db.log);
  });

  it("keeps a manual folder (is_manual_placement) even when the organizer suggests another", async () => {
    const { h, db, drain } = make();
    const body = await (
      await h.POST(postJson(BASE, webClip({ folder_path: "10_Notes/Automotive/" })))
    ).json();
    expect(body).toMatchObject({ folder_path: "10_Notes/Automotive", auto_routed: false });
    await drain();
    const item = db.rows("knowledge_items")[0];
    const folder = db.rows("folders").find((f) => f.folder_path === "10_Notes/Automotive");
    expect(item).toMatchObject({
      folder_path: "10_Notes/Automotive",
      is_manual_placement: true,
      folder_id: folder?.id,
    });
    expect(item?.cluster_name).toBeUndefined();
    expect(db.rows("folders").some((f) => f.folder_path === "30_Clippings/AI")).toBe(false);
  });

  it("dedupes by URL (ignoring tracking params) and merges tags and note", async () => {
    const { h, db, drain, deferred } = make();
    const first = await (await h.POST(postJson(BASE, webClip()))).json();
    await drain();
    const second = await (
      await h.POST(
        postJson(
          BASE,
          webClip({
            url: `${ARTICLE_URL}?utm_source=x#top`,
            tags: ["neu"],
            note: "Nochmal gelesen",
          }),
        ),
      )
    ).json();
    expect(second).toMatchObject({
      item_id: first.item_id,
      duplicate: true,
      queued: false,
      status: "processed",
      type: "article",
    });
    expect(db.rows("knowledge_items")).toHaveLength(1);
    expect(deferred).toHaveLength(1);
    const item = db.rows("knowledge_items")[0];
    expect(item?.tags).toEqual(["ai/mcp", "lesen", "neu"]);
    expect(String(item?.content_md)).toMatch(/## Notiz \(2026-10-23\)\n\nNochmal gelesen\n$/);
  });

  it("keeps a blocked page as a bookmark from the clip's own title", async () => {
    const blocked = fakeFetch([{ match: () => true, respond: () => json({}, 403) }]);
    const { h, db, drain } = make({ fetch: blocked });
    await h.POST(postJson(BASE, webClip({ description: "Was MCP ist." })));
    await drain();
    const item = db.rows("knowledge_items")[0] as {
      status: string;
      content_md: string;
      metadata: { extractor: string };
    };
    expect(item.status).not.toBe("error");
    expect(item.content_md).toContain("> Was MCP ist.");
    expect(item.metadata.extractor).toBe("client");
  });

  it("marks the item as error when extraction fails", async () => {
    const failing = fakeFetch([{ match: () => true, respond: () => json({}, 500) }]);
    const { h, db, drain, errors } = make({ fetch: failing });
    // A clip title that is itself an error page gives no usable bookmark.
    await h.POST(postJson(BASE, webClip({ title: "Access Denied" })));
    await drain();
    const item = db.rows("knowledge_items")[0] as {
      status: string;
      metadata: { ingest: { state: string; error: string } };
    };
    expect(item.status).toBe("error");
    expect(item.metadata.ingest).toMatchObject({
      state: "error",
      error: expect.stringContaining("could not extract"),
    });
    expect(errors[0]?.message).toMatch(/job ingest:.* failed/);
  });
});

describe("POST /api/ingest other kinds", () => {
  const locator = {
    v: 1,
    quote: { exact: "verbindet Agenten", prefix: "Protocol ", suffix: " mit" },
    position: { start: 10, end: 27 },
    range: {
      startXPath: "/html/body/p[1]/text()[1]",
      startOffset: 4,
      endXPath: "/html/body/p[1]/text()[1]",
      endOffset: 21,
    },
  };

  it("highlight: creates the page bookmark once, then attaches further highlights", async () => {
    const { h, db, deferred } = make();
    const req = {
      kind: "highlight",
      url: ARTICLE_URL,
      page_title: "MCP erklärt",
      quote_text: "verbindet Agenten",
      color: "green",
      locator,
      captured_at: "2026-10-23T08:00:00Z",
    };
    const a = await (await h.POST(postJson(BASE, req))).json();
    const b = await (
      await h.POST(postJson(BASE, { ...req, quote_text: "zweites Zitat", note_text: "wichtig" }))
    ).json();
    expect(a).toMatchObject({
      kind: "highlight",
      type: "bookmark",
      duplicate: false,
      queued: true,
      folder_path: "00_Inbox",
    });
    expect(b).toMatchObject({ item_id: a.item_id, duplicate: true, queued: false });
    expect(a.highlight_id).not.toBe(b.highlight_id);
    expect(db.rows("item_highlights")).toEqual([
      expect.objectContaining({
        item_id: a.item_id,
        user_id: USER_ID,
        quote_text: "verbindet Agenten",
        color: "green",
        locator,
      }),
      expect.objectContaining({ quote_text: "zweites Zitat", note_text: "wichtig" }),
    ]);
    expect(deferred).toHaveLength(1);
  });

  it("ai_chat: files into 40_AI_Memories, keeps the chat title, re-export updates the same memory", async () => {
    const { h, db, drain } = make();
    const req = {
      kind: "ai_chat",
      platform: "claude",
      scope: "chat",
      url: "https://claude.ai/chat/abc",
      title: "Supabase RLS Debugging",
      content_md:
        "### User\nWarum greift RLS nicht?\n\n### Assistant\nWeil der Service-Role-Key RLS umgeht.",
      message_count: 2,
      folder_path: "40_AI_Memories",
      captured_at: "2026-10-22T21:00:00Z",
    };
    const a = await (await h.POST(postJson(BASE, req))).json();
    expect(a).toMatchObject({
      type: "ai_chat",
      folder_path: "40_AI_Memories",
      auto_routed: false,
      duplicate: false,
      file: "2026-10-22_supabase-rls-debugging.md",
    });
    await drain();
    expect(db.rows("knowledge_items")[0]).toMatchObject({
      type: "ai_chat",
      title: "Supabase RLS Debugging",
      source_platform: "claude",
      folder_path: "40_AI_Memories",
      is_manual_placement: true,
      status: "processed",
    });
    expect((db.rows("knowledge_items")[0]?.metadata as Record<string, unknown>).ai_title).toBe(
      "MCP für Second Brains",
    );

    const b = await (
      await h.POST(
        postJson(BASE, {
          ...req,
          content_md: `${req.content_md}\n\n### User\nDanke!`,
          message_count: 3,
        }),
      )
    ).json();
    expect(b).toMatchObject({ item_id: a.item_id, duplicate: true, queued: true });
    expect(db.rows("knowledge_items")).toHaveLength(1);
  });

  it("note: quick capture with optional folder", async () => {
    const { h, db, drain } = make();
    const res = await (
      await h.POST(postJson(BASE, { kind: "note", content_md: "# Idee\nMCP-Tool für Rezepte" }))
    ).json();
    expect(res).toMatchObject({ kind: "note", type: "note", auto_routed: true });
    expect(db.rows("knowledge_items")[0]?.title).toBe("Idee");
    await drain();
    expect(db.rows("knowledge_items")[0]).toMatchObject({
      status: "processed",
      title: "MCP für Second Brains",
    });
  });

  it("voice note: same pipeline as a typed note (organizer title, auto-routing, type voice)", async () => {
    const { h, db, drain } = make();
    const res = await (
      await h.POST(
        postJson(BASE, {
          kind: "note",
          content_md: "Erinnere mich morgen daran, das Angebot für Müller fertigzustellen.",
          title: "Sprachnotiz 0:07",
          type_hint: "voice",
        }),
      )
    ).json();
    expect(res).toMatchObject({ kind: "note", type: "voice", auto_routed: true, queued: true });
    expect(db.rows("knowledge_items")[0]?.title).toBe("Sprachnotiz 0:07"); // placeholder until processed
    await drain();
    expect(db.rows("knowledge_items")[0]).toMatchObject({
      type: "voice",
      status: "processed",
      title: "MCP für Second Brains", // the organizer's title, not the placeholder
      folder_path: "30_Clippings/AI",
      is_manual_placement: false,
    });
  });

  it("file upload (multipart): image goes through vision OCR and storage", async () => {
    const vision = mockModel([
      {
        title_hint: "Whiteboard Sync",
        image_kind: "whiteboard",
        ocr_text: "md-sync",
        description_md: "- Sync",
        todos: [],
      },
    ]);
    const { h, db, drain, errors } = make({
      models: mockRouter({ fast: mockModel([enrichment]), vision }),
    });
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "board.png", { type: "image/png" }),
    );
    form.append("folder_path", "10_Notes");
    form.append("tags", "whiteboard, sync");
    const res = await (
      await h.POST(new Request(BASE, authed({ method: "POST", body: form })))
    ).json();
    expect(res).toMatchObject({
      kind: "file",
      type: "image",
      folder_path: "10_Notes",
      auto_routed: false,
    });
    expect(db.rows("knowledge_items")[0]).toMatchObject({
      title: "board",
      file_size_bytes: 4,
      tags: ["whiteboard", "sync"],
    });
    await drain();
    expect(errors).toEqual([]);
    expect([...db.storage.keys()]).toEqual([`kortex-media/${USER_ID}/${res.item_id}.png`]);
    expect(db.rows("knowledge_items")[0]).toMatchObject({
      type: "image",
      status: "processed",
      file_storage_path: `${USER_ID}/${res.item_id}.png`,
      folder_path: "10_Notes",
    });
  });

  it("rejects unsupported and oversized uploads", async () => {
    const { h } = make();
    const form = new FormData();
    form.append("file", new File(["x"], "virus.exe", { type: "application/x-msdownload" }));
    const bad = await h.POST(new Request(BASE, authed({ method: "POST", body: form })));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/nicht unterstützt/);

    const big = await h.POST(
      new Request(
        BASE,
        authed({
          method: "POST",
          body: form,
          headers: { "content-length": String(60 * 1024 * 1024) },
        }),
      ),
    );
    expect(big.status).toBe(413);
  });

  it("validates JSON bodies with Zod and reports the field", async () => {
    const { h } = make();
    const res = await h.POST(postJson(BASE, { kind: "web_clip", url: "ftp://x", title: "t" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toMatch(/^url: /);
    const broken = await h.POST(
      new Request(
        BASE,
        authed({ method: "POST", body: "{", headers: { "content-type": "application/json" } }),
      ),
    );
    expect((await broken.json()).error.message).toMatch(/JSON/);
  });

  it("summary_level (C1): detailed asks the organizer for a longer summary, concise is the default", async () => {
    const promptOf = (m: ReturnType<typeof mockModel>) =>
      JSON.stringify(m.doGenerateCalls[0]?.prompt ?? "");

    const detailedModel = mockModel([enrichment]);
    const detailed = make({ models: mockRouter({ fast: detailedModel }) });
    const res = await detailed.h.POST(postJson(BASE, webClip({ summary_level: "detailed" })));
    expect(res.status).toBe(200);
    await detailed.drain();
    expect(detailed.errors).toEqual([]);
    expect(promptOf(detailedModel)).toContain("detailed summary of 5-8 sentences");
    expect(promptOf(detailedModel)).toContain("6 to 10 short key points");
    const item = detailed.db.rows("knowledge_items")[0] as Record<string, unknown>;
    expect(item.metadata).toMatchObject({ summary_level: "detailed" });

    const conciseModel = mockModel([enrichment]);
    const concise = make({ models: mockRouter({ fast: conciseModel }) });
    await concise.h.POST(postJson(BASE, webClip()));
    await concise.drain();
    expect(promptOf(conciseModel)).toContain("2-3 sentence executive summary (TL;DR)");
    expect(promptOf(conciseModel)).not.toContain("detailed summary");
    const plain = concise.db.rows("knowledge_items")[0] as Record<string, unknown>;
    expect((plain.metadata as Record<string, unknown>).summary_level).toBeUndefined();

    const bad = await concise.h.POST(postJson(BASE, webClip({ summary_level: "lang" })));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/^summary_level: /);
  });

  it("routing guide (G6b): the organizer prompt carries the routing part of agents.md", async () => {
    const model = mockModel([enrichment]);
    const t = make({ models: mockRouter({ fast: model }) });
    await t.h.POST(postJson(BASE, webClip()));
    await t.drain();
    expect(t.errors).toEqual([]);
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt ?? "");
    expect(prompt).toContain("<routing_guide>");
    expect(prompt).toContain("## Routing rules");
    expect(prompt).not.toContain("## MCP tools");
  });

  it("GET ?item_id= reports processing status", async () => {
    const { h, drain } = make();
    const { item_id } = await (await h.POST(postJson(BASE, webClip()))).json();
    await drain();
    const res = await (await h.GET(new Request(`${BASE}?item_id=${item_id}`, authed()))).json();
    expect(res).toEqual({
      ok: true,
      user_id: USER_ID,
      item: {
        item_id,
        status: "processed",
        type: "article",
        title: "MCP für Second Brains",
        folder_path: "30_Clippings/AI",
        // The mock organizer gives no confidence: filed automatically (zero-setup).
        placement: { confidence: null, decision: "auto" },
      },
    });
    const missing = await h.GET(
      new Request(`${BASE}?item_id=44444444-4444-4444-8444-444444444444`, authed()),
    );
    expect(missing.status).toBe(404);
  });

  it("does not see other users' items in dedupe", async () => {
    const db = new FakeSupabase({
      knowledge_items: [
        {
          id: "other",
          user_id: "99999999-9999-4999-8999-999999999999",
          source_url: ARTICLE_URL,
          type: "article",
        },
      ],
    });
    const { h } = make({ db });
    const res = await (await h.POST(postJson(BASE, webClip()))).json();
    expect(res.duplicate).toBe(false);
  });
});

describe("CORS", () => {
  it("answers extension preflights and tags responses with the extension origin", async () => {
    const { h } = make();
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const pre = await h.OPTIONS(new Request(BASE, { method: "OPTIONS", headers: { origin } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(origin);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    const res = await h.GET(new Request(BASE, authed({ headers: { origin } })));
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    const evil = await h.OPTIONS(
      new Request(BASE, { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
    );
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("helpers", () => {
  it("normalizes URLs for dedupe", () => {
    expect(normalizeUrl("https://a.de/x?utm_source=n&id=3&fbclid=1#frag")).toBe(
      "https://a.de/x?id=3",
    );
  });

  it("derives vault file names like the extension", async () => {
    const ext = await loadExtensionApi();
    const at = new Date("2026-10-22T21:00:00Z");
    for (const t of ["Supabase RLS Debugging", "Größe & Maße: über 9000!", "   "]) {
      expect(memoryFileName(t, at)).toBe(ext.memoryFileName(t, at));
    }
  });
});

describe("extension contract (apps/extension client against this route)", () => {
  it("web_clip, highlight and ai_chat round-trip through the extension's own client", async () => {
    const { h } = make();
    const { createApiClient, clientInfo } = await loadExtensionApi();
    const client = createApiClient({
      getSettings: async () =>
        ({ mockMode: false, baseUrl: "https://kortex.test", token: API_TOKEN }) as never,
      fetchImpl: (input, init) => h.POST(new Request(input as URL, init)),
    });
    const base = { client: clientInfo("0.1.0"), captured_at: "2026-10-23T08:00:00Z" };

    const clip = await client.ingest({
      ...base,
      kind: "web_clip",
      url: ARTICLE_URL,
      title: "MCP",
      tags: ["ai/mcp"],
    });
    expect(clip).toMatchObject({ ok: true, kind: "web_clip", status: "inbox", auto_routed: true });

    const hl = await client.ingest({
      ...base,
      kind: "highlight",
      url: ARTICLE_URL,
      page_title: "MCP",
      quote_text: "Agenten",
      locator: {
        v: 1,
        quote: { exact: "Agenten", prefix: "", suffix: "" },
        position: { start: 0, end: 7 },
        range: { startXPath: "/p", startOffset: 0, endXPath: "/p", endOffset: 7 },
      },
    });
    expect(hl).toMatchObject({ ok: true, duplicate: true });
    expect(hl.ok && hl.highlight_id).toBeTruthy();

    const chat = await client.ingest({
      ...base,
      kind: "ai_chat",
      platform: "chatgpt",
      scope: "answer",
      url: "https://chatgpt.com/c/1",
      title: "Antwort",
      content_md: "### Assistant\nHallo",
      message_count: 1,
      folder_path: "40_AI_Memories",
    });
    expect(chat).toMatchObject({ ok: true, type: "ai_chat", file: "2026-10-23_antwort.md" });

    let stated: string | null = null;
    const denied = await createApiClient({
      getSettings: async () =>
        ({ mockMode: false, baseUrl: "https://kortex.test", token: "wrong" }) as never,
      fetchImpl: (input, init) => {
        const req = new Request(input as URL, init);
        stated = req.headers.get("accept-language");
        return h.POST(req);
      },
    }).ingest({ ...base, kind: "web_clip", url: ARTICLE_URL, title: "MCP" });
    // The extension client states its language and the server answers in it. Which one it states
    // depends on whether the client shares this suite's @kortex/i18n instance (German) or loads
    // its own (English), so the expectation follows the header it sent.
    expect(["en", "de"]).toContain(stated);
    expect(denied).toEqual({
      ok: false,
      error: { code: "unauthorized", message: stated === "de" ? "Ungültiges API-Token" : "Invalid API token" },
    });
  });
});
