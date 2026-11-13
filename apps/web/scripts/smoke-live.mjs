#!/usr/bin/env node
// Live end-to-end smoke test of the web app against the real Supabase + OpenRouter.
//
//   node --env-file=.env.local scripts/smoke-live.mjs create <creds.json>
//       signs up ONE test user kortex-e2e+<date>-<rand>@example.com (needs signups with
//       auto-confirm), writes { email, password, userId } to <creds.json> (keep it outside the repo)
//   node --env-file=.env.local scripts/smoke-live.mjs run <creds.json> [baseUrl]
//       signs in, bootstraps, sets cheap models (google/gemini-2.5-flash), ingests one note and one
//       public URL through /api/ingest, waits for the pipeline, counts rows/chunks/embeddings and
//       asks /api/chat one hybrid-RAG question. Prints counts only, never keys or tokens.
//
// Cleanup is separate on purpose: delete the user by its exact id (admin API with the service
// role key, or `delete from auth.users where id = '<id>'`); kortex.* rows cascade.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [mode, credsFile, baseUrl = "http://localhost:3000"] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon || !credsFile || !["create", "run"].includes(mode)) {
  console.error("usage: smoke-live.mjs create|run <creds.json> [baseUrl]  (needs NEXT_PUBLIC_SUPABASE_*)");
  process.exit(2);
}
const MODEL = "google/gemini-2.5-flash";
const client = () => createClient(url, anon, { db: { schema: "kortex" }, auth: { persistSession: false } });

if (mode === "create") {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const email = `kortex-e2e+${day}-${randomBytes(3).toString("hex")}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await client().auth.signUp({ email, password });
  if (error || !data.user) throw new Error(`signup failed: ${error?.message}`);
  if (!data.session) throw new Error("signup needs e-mail confirmation; cannot continue");
  writeFileSync(credsFile, JSON.stringify({ email, password, userId: data.user.id }));
  console.log(`created test user ${email} id=${data.user.id}`);
  process.exit(0);
}

const creds = JSON.parse(readFileSync(credsFile, "utf8"));
const sb = client();
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password });
if (authErr || !auth.session) throw new Error(`sign-in failed: ${authErr?.message}`);
const uid = auth.user.id;
const headers = { authorization: `Bearer ${auth.session.access_token}`, "content-type": "application/json" };
console.log(`signed in as ${creds.email}`);

const ok = (what, r) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

ok("bootstrap", await sb.rpc("bootstrap_user"));
const folders = ok("folders", await sb.from("folders").select("id", { count: "exact" }).eq("user_id", uid));
console.log(`bootstrap: ${folders.length} folders`);
ok(
  "settings",
  await sb.from("user_settings").update({ preferred_chat_model: MODEL, preferred_fast_model: MODEL }).eq("user_id", uid),
);

async function api(path, body) {
  const res = await fetch(baseUrl + path, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body) });
  return { status: res.status, res };
}

const ingest = async (payload) => {
  const { status, res } = await api("/api/ingest", payload);
  const json = await res.json();
  if (!json.ok) throw new Error(`ingest ${payload.kind} -> ${status} ${JSON.stringify(json.error)}`);
  console.log(`ingest ${payload.kind}: ${status} item=${json.item_id} status=${json.status}`);
  return json.item_id;
};

const noteId = await ingest({
  kind: "note",
  title: "Kortex Smoke Test Hyrox Plan",
  content_md:
    "# Hyrox Trainingsplan\n\nZiel: Hyrox Berlin im März. Drei Einheiten pro Woche: Sled Push, Wall Balls, 8 km Lauf.\n\n- [ ] Sled Push Technik mit Coach üben\n- [ ] Laufschuhe kaufen\n\nWichtig: Regeneration und genug Protein (2 g pro kg).",
});
const clipId = await ingest({ kind: "web_clip", url: "https://example.com/", title: "Example Domain" });

async function waitFor(id) {
  const t0 = Date.now();
  for (;;) {
    const { res } = await api(`/api/ingest?item_id=${id}`);
    const j = await res.json();
    const st = j.item?.status;
    if (st === "processed" || st === "error") return { status: st, seconds: Math.round((Date.now() - t0) / 1000), error: j.item?.error };
    if (Date.now() - t0 > 180_000) return { status: `timeout (${st})`, seconds: 180 };
    await new Promise((r) => setTimeout(r, 3000));
  }
}
for (const [name, id] of [["note", noteId], ["web_clip", clipId]]) {
  const w = await waitFor(id);
  console.log(`pipeline ${name}: ${w.status} after ${w.seconds}s${w.error ? ` (${JSON.stringify(w.error)})` : ""}`);
}

const items = ok("items", await sb.from("knowledge_items").select("id,type,status,folder_path,tags,summary").eq("user_id", uid));
const chunks = ok("chunks", await sb.from("item_chunks").select("item_id,embedding").eq("user_id", uid));
const actions = ok("actions", await sb.from("action_items").select("id").eq("user_id", uid));
const tags = ok("tags", await sb.from("tags").select("name").eq("user_id", uid));
console.log(`rows: knowledge_items=${items.length} item_chunks=${chunks.length} with_embedding=${chunks.filter((c) => c.embedding).length} action_items=${actions.length} tags=${tags.length}`);
for (const i of items)
  console.log(`  item ${i.type} ${i.status} -> ${i.folder_path} tags=${(i.tags ?? []).length} summary=${i.summary ? "yes" : "no"}`);

const { status: chatStatus, res: chatRes } = await api("/api/chat", {
  mode: "brain",
  model: MODEL,
  messages: [{ role: "user", content: "Wie viele Trainingseinheiten pro Woche plane ich für Hyrox?" }],
});
const stream = await chatRes.text();
const text = [...stream.matchAll(/"type":"text-delta"[^}]*"delta":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)).join("");
const cites = stream.match(/"type":"data-citations"[\s\S]*?"citations":\[([\s\S]*?)\]\}/);
console.log(`chat: ${chatStatus}, citations=${cites ? (cites[1].match(/"item_id"/g) ?? []).length : 0}, answer: ${text.replace(/\s+/g, " ").slice(0, 240)}`);
