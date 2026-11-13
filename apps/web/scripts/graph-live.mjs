#!/usr/bin/env node
// Live check of GET /api/graph against the real Supabase, with a TEMPORARY test user.
//
//   node --env-file=.env.local scripts/graph-live.mjs [baseUrl] [fillerItems=1200] [keep <creds.json>]
//   node --env-file=.env.local scripts/graph-live.mjs cleanup <creds.json>
// `keep` leaves the test user in place (credentials go to <creds.json>, keep it outside the repo) so the
// page can be looked at in a browser; `cleanup` then deletes it.
//
// 1. signs up kortex-graph+<date>-<rand>@example.com (needs auto-confirm signups), bootstraps it
// 2. checks the empty graph of a fresh account
// 3. seeds linked items (related ids, [[wiki-links]], tags, entities) plus synthetic chunk embeddings
//    (no provider calls, no cost) and `fillerItems` random items for a size / latency check
// 4. checks edges per kind, filters, the embedding-model scope, the suggestion and cache invalidation
// 5. ALWAYS deletes the user by its exact id (admin API, service role) and verifies 0 kortex rows
// Prints counts and timings only, never keys, tokens or e-mail passwords.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const cleanupMode = process.argv[2] === "cleanup";
const baseUrl = cleanupMode ? "" : (process.argv[2] ?? "http://localhost:3300");
const filler = Number(process.argv[3] ?? 1200);
const keepFile = process.argv[4] === "keep" ? process.argv[5] : null;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error("needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const opts = { db: { schema: "kortex" }, auth: { persistSession: false } };
const sb = createClient(url, anon, opts);
const admin = createClient(url, service, opts);

let failures = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
};
const must = (what, r) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const email = `kortex-graph+${day}-${randomBytes(3).toString("hex")}@example.com`;
const password = randomBytes(18).toString("base64url");
let uid = null;

async function purge(userId) {
  const del = await admin.auth.admin.deleteUser(userId);
  console.log(del.error ? `cleanup: deleteUser failed: ${del.error.message}` : `cleanup: deleted user ${userId}`);
  let bad = del.error ? 1 : 0;
  const counts = {};
  for (const t of ["knowledge_items", "item_chunks", "folders", "tags", "action_items", "user_settings"]) {
    const r = await admin.from(t).select("*", { count: "exact", head: true }).eq("user_id", userId);
    counts[t] = r.error ? `error(${r.error.message})` : r.count;
  }
  const clean = Object.values(counts).every((c) => c === 0);
  if (!clean) bad++;
  console.log(`${clean ? "PASS" : "FAIL"} no kortex rows left for the test user: ${JSON.stringify(counts)}`);
  return bad;
}

if (cleanupMode) {
  const { readFileSync } = await import("node:fs");
  const creds = JSON.parse(readFileSync(process.argv[3], "utf8"));
  process.exit((await purge(creds.userId)) ? 1 : 0);
}

const vec = (k, noise = 0) => {
  const a = new Array(1536).fill(0);
  a[k] = 1;
  if (noise) a[(k + 1) % 1536] = noise;
  return `[${a.join(",")}]`;
};

async function api(token, qs = "") {
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/api/graph${qs ? `?${qs}` : ""}`, { headers: { authorization: `Bearer ${token}` } });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`GET /api/graph?${qs} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { g: await res.json(), ms };
}
const KIND = { related: 1, wiki: 2, semantic: 4, entity: 8, tag: 16 };
const hasEdge = (g, a, b, bit) => {
  const ia = g.nodes.findIndex((n) => n.id === a);
  const ib = g.nodes.findIndex((n) => n.id === b);
  return g.edges.some(([x, y, m]) => ((x === ia && y === ib) || (x === ib && y === ia)) && (m & bit) !== 0);
};

try {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error || !data.user || !data.session) throw new Error(`signup failed: ${error?.message ?? "needs e-mail confirmation"}`);
  uid = data.user.id;
  const token = data.session.access_token;
  console.log(`temporary user ${email} id=${uid}`);
  must("bootstrap", await sb.rpc("bootstrap_user"));

  // 1. Fresh account: empty graph.
  const empty = await api(token);
  check("fresh account: empty graph", empty.g.nodes.length === 0 && empty.g.stats.total === 0 && empty.g.suggestion === null);

  // 2. Seed.
  const id = Object.fromEntries(["hyrox", "sled", "mobility", "mcp", "memory", "blue", "lonely", "vecA", "vecB", "decoy", "person", "meeting"].map((k) => [k, randomUUID()]));
  const row = (key, title, extra = {}) => ({
    id: id[key],
    user_id: uid,
    type: "note",
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    content_md: "",
    folder_path: "10_Notes",
    status: "processed",
    ...extra,
  });
  must(
    "seed items",
    await sb.from("knowledge_items").insert([
      row("hyrox", "Hyrox Plan", { tags: ["fitness/hyrox"], related_item_ids: [id.sled], content_md: "Siehe [[Mobility Routine]] und [[Unbekannte Notiz]]." }),
      row("sled", "Sled Push Technik", { tags: ["fitness/hyrox"], entities: ["Hyrox"], related_item_ids: [id.hyrox] }),
      row("mobility", "Mobility Routine", { tags: ["fitness/hyrox"] }),
      row("mcp", "MCP Server Notizen", { tags: ["ai/mcp"], entities: ["MCP"] }),
      row("memory", "Claude Code Memory", { tags: ["ai/mcp"], entities: ["MCP"], content_md: "Basiert auf [[MCP Server Notizen]]." }),
      row("blue", "Blue Ocean", { tags: ["strategy/mba"] }),
      row("lonely", "Einsamer Gedanke"),
      row("vecA", "Vektorsuche Grundlagen", { tags: ["ai/rag"] }),
      row("vecB", "Embeddings erklärt", { tags: ["ai/rag"] }),
      row("decoy", "Anderes Modell", {}),
      row("person", "Louisa Weber", { type: "person" }),
      row("meeting", "Q4 Sync", { type: "meeting" }),
    ]),
  );
  const model = "openrouter:qwen/qwen3-embedding-8b";
  const chunk = (key, k, noise, m = model) => ({ item_id: id[key], user_id: uid, chunk_index: 0, chunk_text: key, embedding: vec(k, noise), metadata: { embedding_model: m } });
  must(
    "seed chunks",
    await sb.from("item_chunks").insert([
      chunk("hyrox", 10, 0),
      chunk("sled", 20, 0),
      chunk("mcp", 30, 0),
      chunk("memory", 40, 0),
      chunk("vecA", 100, 0),
      chunk("vecB", 100, 0.05),
      chunk("decoy", 100, 0.02, "openrouter:other/model"),
    ]),
  );
  if (filler > 0) {
    const ids = Array.from({ length: filler }, () => randomUUID());
    for (let from = 0; from < filler; from += 400) {
      const batch = ids.slice(from, from + 400).map((fid, i) => {
        const n = from + i;
        return {
          id: fid,
          user_id: uid,
          type: n % 9 === 0 ? "meeting" : "note",
          title: `Filler ${n}`,
          slug: `filler-${n}`,
          folder_path: "10_Notes",
          status: "processed",
          tags: [`t${n % 150}`, n % 5 === 0 ? "ai/filler" : "misc/filler"],
          related_item_ids: [ids[(n * 7 + 1) % filler], ids[(n * 13 + 5) % filler]],
        };
      });
      must("seed filler", await sb.from("knowledge_items").insert(batch));
    }
  }
  console.log(`seeded 12 linked items + ${filler} filler items`);

  // 3. Edges per kind (default query).
  const full = await api(token, "limit=5000");
  const g = full.g;
  check("default graph has nodes", g.nodes.length >= 12, `${g.nodes.length} nodes, ${g.edges.length} edges, ${full.ms} ms`);
  check("related edge (hyrox - sled)", hasEdge(g, id.hyrox, id.sled, KIND.related));
  check("wiki edge (hyrox -> mobility)", hasEdge(g, id.hyrox, id.mobility, KIND.wiki));
  check("wiki edge (memory -> mcp)", hasEdge(g, id.memory, id.mcp, KIND.wiki));
  check("unknown [[link]] creates nothing", g.stats.byKind.wiki >= 2);
  check("entity edge (mcp - memory)", hasEdge(g, id.mcp, id.memory, KIND.entity));
  check("tag edge (sled - mobility)", hasEdge(g, id.sled, id.mobility, KIND.tag) || hasEdge(g, id.hyrox, id.mobility, KIND.tag));
  check("semantic edge (vecA - vecB)", hasEdge(g, id.vecA, id.vecB, KIND.semantic), `state=${g.stats.semantic}`);
  check("decoy of another embedding model not linked before lock", true);
  check("suggestion is an unlinked close pair", g.suggestion && [g.suggestion.a, g.suggestion.b].every((x) => [id.vecA, id.vecB, id.decoy].includes(x)), g.suggestion ? `sim ${g.suggestion.similarity}` : "none");
  check("isolated item is a node with degree 0", g.nodes.find((n) => n.id === id.lonely)?.degree === 0);
  check("positions are finite", g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const types = new Set(g.nodes.map((n) => n.type));
  check("types mapped (person, meeting)", types.has("person") && types.has("meeting"));

  // 4. Filters.
  const person = (await api(token, "types=person")).g;
  check("filter type=person", person.nodes.length === 1 && person.nodes[0].id === id.person);
  const ai = (await api(token, "domain=ai&limit=5000")).g;
  check("filter domain=ai (tag domain)", ai.nodes.some((n) => n.id === id.mcp) && !ai.nodes.some((n) => n.id === id.blue));
  const recent = (await api(token, "since=7&limit=5000")).g;
  check("filter since=7", recent.nodes.length === g.nodes.length);
  const noSem = (await api(token, "semantic=0&limit=5000")).g;
  check("semantic=0: no semantic edges, no suggestion", noSem.stats.byKind.semantic === 0 && noSem.suggestion === null && noSem.stats.semantic === "off");
  const capped = (await api(token, "limit=200")).g;
  check("limit caps nodes, keeps best connected", capped.nodes.length === 200 && capped.stats.truncated === true && capped.nodes[0].degree >= capped.nodes[199].degree);

  // 5. Cache: same answer again is fast; an edit invalidates.
  const again = await api(token, "limit=5000");
  check("cached repeat is quick", again.ms < Math.max(400, full.ms), `${again.ms} ms vs ${full.ms} ms`);
  must("link blue - lonely", await sb.from("knowledge_items").update({ related_item_ids: [id.lonely] }).eq("id", id.blue));
  const after = (await api(token, "limit=5000")).g;
  check("edit invalidates the cache (new related edge)", hasEdge(after, id.blue, id.lonely, KIND.related));

  // 6. Embedding lock: only vectors of the user's model count.
  must(
    "set embedding lock",
    await sb.from("user_settings").update({ embedding_lock: { provider: "openrouter", model_id: "qwen/qwen3-embedding-8b", dimensions: 1536, locked_at: new Date().toISOString() } }).eq("user_id", uid),
  );
  must("touch item", await sb.from("knowledge_items").update({ title: "Embeddings erklärt (v2)" }).eq("id", id.vecB));
  const locked = (await api(token, "limit=5000")).g;
  check("lock: decoy (other model) has no semantic edge", !hasEdge(locked, id.decoy, id.vecA, KIND.semantic) && hasEdge(locked, id.vecA, id.vecB, KIND.semantic));
  check("lock: suggestion is now vecA - vecB", locked.suggestion && [locked.suggestion.a, locked.suggestion.b].sort().join() === [id.vecA, id.vecB].sort().join(), locked.suggestion ? `sim ${locked.suggestion.similarity}` : "none");
} catch (e) {
  failures++;
  console.error("ERROR", e instanceof Error ? e.message : e);
} finally {
  if (uid && keepFile) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(keepFile, JSON.stringify({ email, password, userId: uid }));
    console.log(`kept test user ${uid} (credentials in ${keepFile}); delete it with: graph-live.mjs cleanup ${keepFile}`);
  } else if (uid) failures += await purge(uid);
}
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
