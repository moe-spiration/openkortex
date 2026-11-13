#!/usr/bin/env node
// Phase-1 acceptance audit (Doc 01 domains A–E, MVP Phase 1) against a RUNNING production build
// and the live database. Not part of the gates: it spends a little AI money (organizer, vision,
// embeddings, chat; a few cents) and needs network.
//
//   pnpm --filter @kortex/web build
//   node e2e/support/serve-prod.mjs            # :3500, or any running Kortex web server
//   node --env-file=.env.local scripts/phase1-audit.mjs [--base http://localhost:3500] [--out report.json] [--keep]
//
// Creates ONE temporary allowlisted user (kortex-e2e+audit-…@example.com), runs every check
// through the public API like a client would, records evidence (row values, counts, timings; never
// secrets) and deletes the user again (all kortex rows cascade; storage objects removed).
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://localhost:3500");
const OUT = arg("--out", join(web, "phase1-audit.json"));
const KEEP = process.argv.includes("--keep");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) throw new Error("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY missing");
const admin = createClient(url, service, { auth: { persistSession: false } });
const db = createClient(url, service, { db: { schema: "kortex" }, auth: { persistSession: false } });

const results = [];
const t0 = Date.now();
function record(id, feature, status, evidence) {
  results.push({ id, feature, status, evidence });
  console.log(`${status.padEnd(8)} ${id.padEnd(5)} ${feature}${evidence?.note ? `  (${evidence.note})` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- user lifecycle ------------------------------------------------------------------------------
const email = `kortex-e2e+audit-${randomBytes(3).toString("hex")}@example.com`;
const password = randomBytes(18).toString("base64url");
const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createErr) throw createErr;
const userId = created.user.id;
console.log(`temp user ${email}`);

async function cleanup() {
  if (KEEP) return console.log(`--keep: user ${userId} kept`);
  for (const b of ["kortex-documents", "kortex-media", "kortex-audio"]) {
    const { data } = await admin.storage.from(b).list(userId, { limit: 1000 });
    const paths = (data ?? []).map((f) => `${userId}/${f.name}`);
    if (paths.length) await admin.storage.from(b).remove(paths);
  }
  await admin.auth.admin.deleteUser(userId);
  const left = [];
  for (const t of ["knowledge_items", "item_chunks", "item_highlights", "action_items", "folders", "tags", "user_settings", "allowed_users", "ai_usage", "ingest_jobs", "user_insights"]) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true }).eq("user_id", userId);
    if (!error && count) left.push(`${t}=${count}`);
  }
  console.log(`cleanup: user deleted, rows left: ${left.join(" ") || "0"}`);
  return left;
}

let token;
const H = () => ({ authorization: `Bearer ${token}` });
async function api(path, body, { method, raw } = {}) {
  const init = { method: method ?? (body ? "POST" : "GET"), headers: { ...H() } };
  if (body instanceof FormData) init.body = body;
  else if (body) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* stream or html */
  }
  return { status: res.status, json, text };
}

const ITEM_COLS =
  "id,type,status,title,slug,summary,content_md,source_url,cover_image_url,folder_path,cluster_name,is_manual_placement,tags,entities,related_item_ids,metadata,file_storage_path,flashcards";
const item = async (id) => (await db.from("knowledge_items").select(ITEM_COLS).eq("user_id", userId).eq("id", id).single()).data;
const chunks = async (id) => (await db.from("item_chunks").select("chunk_index,chunk_heading,page_or_timestamp,embedding").eq("user_id", userId).eq("item_id", id)).data ?? [];

async function waitProcessed(id, timeoutMs = 240_000) {
  const start = Date.now();
  for (;;) {
    const r = await api(`/api/ingest?item_id=${id}`);
    const st = r.json?.item?.status;
    if (st === "processed" || st === "error") return { status: st, seconds: Math.round((Date.now() - start) / 1000), error: r.json?.item?.error };
    if (Date.now() - start > timeoutMs) return { status: `timeout(${st})`, seconds: Math.round(timeoutMs / 1000) };
    await sleep(3000);
  }
}

/** Ingest + wait + load the row; never throws (a failure is evidence). */
async function capture(label, body) {
  try {
    const r = await api("/api/ingest", body);
    if (!r.json?.ok) return { label, ok: false, http: r.status, error: r.json?.error ?? r.text.slice(0, 200) };
    const w = r.json.status === "processed" && !r.json.queued ? { status: "processed", seconds: 0 } : await waitProcessed(r.json.item_id);
    const row = await item(r.json.item_id);
    const ch = await chunks(r.json.item_id);
    return { label, ok: w.status === "processed", accepted: r.json, wait: w, row, chunks: ch };
  } catch (err) {
    return { label, ok: false, error: String(err) };
  }
}

const brief = (row) =>
  row && {
    type: row.type,
    status: row.status,
    title: row.title,
    folder: row.folder_path,
    cluster: row.cluster_name,
    manual: row.is_manual_placement,
    tags: row.tags,
    entities: (row.entities ?? []).slice(0, 8),
    summary_chars: row.summary?.length ?? 0,
    content_chars: row.content_md?.length ?? 0,
    cover: !!row.cover_image_url,
    related: (row.related_item_ids ?? []).length,
    placement: row.metadata?.placement ?? null,
    adapter: row.metadata?.ingest?.adapter ?? null,
  };
const chunkInfo = (ch) => ({
  chunks: ch.length,
  embedded: ch.filter((c) => c.embedding).length,
  locators: [...new Set(ch.map((c) => c.page_or_timestamp).filter(Boolean))].slice(0, 6),
  headings: [...new Set(ch.map((c) => c.chunk_heading).filter(Boolean))].slice(0, 4),
});
const isHierTag = (t) => /^[a-z0-9äöüß-]+(\/[a-z0-9äöüß-]+)*$/.test(t);

let leftover = [];
try {
  // allowlist + sign in + bootstrap (like the invite flow)
  const al = await db.from("allowed_users").insert({ user_id: userId, email, role: "member", note: "phase1 audit temp user" });
  if (al.error) throw new Error(`allowlist: ${al.error.message}`);
  const sb = createClient(url, anon, { db: { schema: "kortex" }, auth: { persistSession: false } });
  const signIn = await sb.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  token = signIn.data.session.access_token;
  const boot = await sb.rpc("bootstrap_user");
  // Audit only: a higher daily budget so a long run is not cut off by the 2 € default (S2a).
  await db.from("user_settings").update({ daily_ai_budget_eur: Number(process.env.AUDIT_BUDGET_EUR ?? 10) }).eq("user_id", userId);
  const folders = (await db.from("folders").select("folder_path").eq("user_id", userId)).data ?? [];
  record("DB", "Multi-tenant schema, bootstrap (17 system folders), allowlist", !boot.error && folders.length >= 17 ? "live" : "partial", {
    folders: folders.length,
    bootstrap_error: boot.error?.message ?? null,
  });

  // --- A1 / B1–B3: free text ------------------------------------------------------------------------
  const text = await capture("text", {
    kind: "note",
    content_md:
      "Idee für das Q4-Architektur-Review mit Sven Krüger von AutoCorp: Wir ersetzen den nächtlichen Batch-Sync durch Event-Streaming über Kafka und prüfen MCP als Agenten-Schnittstelle. " +
      "TODO: Bis Freitag ein Angebot an AutoCorp schicken. Außerdem Sven wegen der Supabase-Lizenz anrufen.",
  });
  record("A1", "Universal Inbox: free text → typed note, processed", text.ok ? "live" : "missing", { ...brief(text.row), wait: text.wait, error: text.error });
  const tags = text.row?.tags ?? [];
  record("B1", "Hierarchical auto-tagging (2–5 tags, reuse vocabulary)", tags.length >= 2 && tags.length <= 5 && tags.every(isHierTag) ? "live" : tags.length ? "partial" : "missing", {
    tags,
    hierarchical: tags.filter((t) => t.includes("/")).length,
  });
  record("B3", "Auto title + TL;DR for raw input", text.row?.title && (text.row?.summary?.length ?? 0) > 40 ? "live" : "partial", {
    title: text.row?.title,
    summary_chars: text.row?.summary?.length ?? 0,
  });
  const tasks = (await db.from("action_items").select("title,priority,due_date,assignee,source_item_id").eq("user_id", userId).eq("source_item_id", text.accepted?.item_id ?? "-")).data ?? [];
  record("C4", "Action items extracted into the task hub (owner, due date, priority, source link)", tasks.length >= 1 ? "live" : "missing", {
    tasks: tasks.map((t) => ({ title: t.title, priority: t.priority, due: t.due_date, assignee: t.assignee })),
  });

  // --- B2: manual placement respected ---------------------------------------------------------------
  const manual = await capture("manual", {
    kind: "note",
    title: "Hyrox Trainingsplan Block 3",
    folder_path: "10_Notes/Projekte/Audit",
    content_md: "Drei Einheiten pro Woche: Sled Push, Wall Balls, 8 km Lauf. Regeneration am Sonntag.",
  });
  record("B2", "Auto-clustering + manual folder freedom (is_manual_placement kept)", manual.row?.is_manual_placement && manual.row?.folder_path === "10_Notes/Projekte/Audit" && text.row?.cluster_name ? "live" : "partial", {
    auto_item: { folder: text.row?.folder_path, cluster: text.row?.cluster_name, placement: text.row?.metadata?.placement ?? null },
    manual_item: { folder: manual.row?.folder_path, manual: manual.row?.is_manual_placement, cluster: manual.row?.cluster_name },
  });

  // --- B5 / B4: object + entity linking ---------------------------------------------------------------
  const person = await capture("object", {
    kind: "note",
    title: "Sven Krüger",
    type_hint: "person",
    content_md: "Sven Krüger ist CTO bei AutoCorp und verantwortet die Plattform-Architektur.",
  });
  const mention = await capture("mention", {
    kind: "note",
    content_md: "Im Steering Committee hat Sven Krüger die Kafka-Migration freigegeben; AutoCorp will bis Q1 umstellen.",
  });
  const linked = (mention.row?.related_item_ids ?? []).includes(person.accepted?.item_id) || /\[\[Sven Krüger\]\]/.test(mention.row?.content_md ?? "");
  record("B5", "AI-native object (person) in 70_Objects with typed metadata", person.row?.type === "person" && /^70_Objects\/People/.test(person.row?.folder_path ?? "") ? "live" : person.row?.type === "person" ? "partial" : "missing", brief(person.row));
  record("B4", "Entity extraction + auto-link to existing objects ([[Wiki-Link]] / related)", (mention.row?.entities ?? []).length && linked ? "live" : (mention.row?.entities ?? []).length ? "partial" : "missing", {
    entities: mention.row?.entities,
    linked_to_object: linked,
    wiki_link_in_body: /\[\[Sven Krüger\]\]/.test(mention.row?.content_md ?? ""),
  });

  // --- A2: web article + dedupe -----------------------------------------------------------------------
  const ARTICLE = process.env.AUDIT_ARTICLE_URL ?? "https://blog.cloudflare.com/the-road-to-quic/";
  const art = await capture("article", { kind: "web_clip", url: ARTICLE, title: "Artikel" });
  record("A2", "Web article clipper: clean Markdown, metadata, hero cover", art.ok && (art.row?.content_md?.length ?? 0) > 5000 ? (art.row?.cover_image_url ? "live" : "partial") : "missing", {
    ...brief(art.row),
    ...chunkInfo(art.chunks ?? []),
    canonical_url: art.row?.metadata?.canonical_url ?? null,
    author: art.row?.metadata?.author ?? art.row?.metadata?.byline ?? null,
    published: art.row?.metadata?.published_time ?? art.row?.metadata?.published_at ?? null,
    reading_minutes: art.row?.metadata?.reading_minutes ?? art.row?.metadata?.reading_time ?? null,
    error: art.error ?? art.wait?.error,
  });
  const dup = await api("/api/ingest", { kind: "web_clip", url: `${ARTICLE}?utm_source=audit#top`, title: "Artikel" });
  record("B4b", "URL dedupe (tracking params/fragment stripped, same item)", dup.json?.duplicate === true && dup.json?.item_id === art.accepted?.item_id ? "live" : "missing", {
    duplicate: dup.json?.duplicate,
    same_item: dup.json?.item_id === art.accepted?.item_id,
  });

  // --- A3: PDF + EPUB -------------------------------------------------------------------------------------
  const fileCapture = async (label, path, type, name) => {
    const fd = new FormData();
    fd.append("file", new Blob([readFileSync(path)], { type }), name);
    return capture(label, fd);
  };
  const pdf = await fileCapture("pdf", join(web, "public/mock/docs/ai-engineering-ch3.pdf"), "application/pdf", "AI_Engineering_ch3.pdf");
  record("A3", "PDF ingestion: stored in Storage, pages for page-exact RAG", pdf.ok && pdf.row?.file_storage_path && (pdf.chunks ?? []).some((c) => c.page_or_timestamp) ? "live" : pdf.ok ? "partial" : "missing", {
    ...brief(pdf.row),
    ...chunkInfo(pdf.chunks ?? []),
    stored: !!pdf.row?.file_storage_path,
    page_count: pdf.row?.metadata?.page_count ?? null,
    error: pdf.error ?? pdf.wait?.error,
  });
  const epub = await fileCapture("epub", join(web, "public/mock/docs/ai-engineering-ch3.epub"), "application/epub+zip", "AI_Engineering_ch3.epub");
  record("A3b", "EPUB ingestion: chapters as chunks, stored for the reader", epub.ok && epub.row?.file_storage_path && (epub.chunks ?? []).length ? "live" : epub.ok ? "partial" : "missing", {
    ...brief(epub.row),
    ...chunkInfo(epub.chunks ?? []),
    stored: !!epub.row?.file_storage_path,
    error: epub.error ?? epub.wait?.error,
  });

  // --- A8: image OCR ---------------------------------------------------------------------------------------
  const img = await fileCapture("image", join(repo, "design/qa/2026-10-24/after/inbox__light__1100.png"), "image/png", "kortex-inbox-screenshot.png");
  record("A8", "Vision OCR for screenshots: text + semantic description, searchable", img.ok && (img.row?.content_md?.length ?? 0) > 200 && (img.chunks ?? []).length ? "live" : img.ok ? "partial" : "missing", {
    ...brief(img.row),
    ...chunkInfo(img.chunks ?? []),
    content_sample: (img.row?.content_md ?? "").replace(/\s+/g, " ").slice(0, 160),
    error: img.error ?? img.wait?.error,
  });

  // --- A4: YouTube -------------------------------------------------------------------------------------------
  const yt = await capture("youtube", { kind: "web_clip", url: "https://www.youtube.com/watch?v=aircAruvnKk", title: "But what is a neural network?" });
  record("A4", "YouTube: transcript with timestamps, summary, chapters, entities", yt.ok && (yt.chunks ?? []).some((c) => /\d+:\d{2}/.test(c.page_or_timestamp ?? "")) ? "live" : yt.ok ? "partial" : "missing", {
    ...brief(yt.row),
    ...chunkInfo(yt.chunks ?? []),
    transcript_source: yt.row?.metadata?.transcript_source ?? yt.row?.metadata?.transcript?.source ?? null,
    error: yt.error ?? yt.wait?.error,
  });

  // --- A7: Chefkoch recipe -------------------------------------------------------------------------------------
  let recipeUrl = null;
  try {
    const home = await (await fetch("https://www.chefkoch.de/", { headers: { "user-agent": "Mozilla/5.0" } })).text();
    recipeUrl = home.match(/https:\/\/www\.chefkoch\.de\/rezepte\/\d+\/[A-Za-z0-9%-]+\.html/)?.[0] ?? null;
  } catch {
    /* recorded below */
  }
  if (recipeUrl) {
    const rec = await capture("recipe", { kind: "web_clip", url: recipeUrl, title: "Rezept" });
    const md = rec.row?.content_md ?? "";
    record("A7", "Recipe parser: ingredients, steps, servings, macro estimate", rec.row?.type === "recipe" && /zutat|ingredient/i.test(md) ? (rec.row?.metadata?.macros || /kcal|protein|eiweiß/i.test(md) ? "live" : "partial") : rec.ok ? "partial" : "missing", {
      url: recipeUrl,
      ...brief(rec.row),
      servings: rec.row?.metadata?.servings ?? rec.row?.metadata?.recipe?.servings ?? null,
      macros: rec.row?.metadata?.macros ?? rec.row?.metadata?.recipe?.nutrition ?? null,
      error: rec.error ?? rec.wait?.error,
    });
  } else record("A7", "Recipe parser (Chefkoch)", "unknown", { note: "no Chefkoch recipe URL found on the homepage" });

  // --- E1: hybrid RAG chat with citations ----------------------------------------------------------------------
  const chatRes = await api("/api/chat", { mode: "brain", messages: [{ role: "user", content: "Was steht in meinem Dokument über Chunk-Größe und Überlappung beim Contextual Retrieval?" }] });
  const cites = (() => {
    const m = chatRes.text.match(/"type":"data-citations"[^\n]*?"citations":(\[[\s\S]*?\])\}/);
    try {
      return m ? JSON.parse(m[1]) : [];
    } catch {
      return [];
    }
  })();
  const answer = [...chatRes.text.matchAll(/"type":"text-delta"[^}]*"delta":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)).join("");
  record("E1", "Hybrid RAG chat over the whole brain with clickable page/timestamp citations", chatRes.status === 200 && cites.length && /\[\d+\]/.test(answer) ? (cites.some((c) => c.page_or_timestamp) ? "live" : "partial") : "missing", {
    http: chatRes.status,
    citations: cites.slice(0, 5).map((c) => ({ title: c.title, type: c.type, page: c.page_or_timestamp })),
    answer_sample: answer.slice(0, 200),
  });

  // --- E1b: editor agent actions + flashcards ----------------------------------------------------------------------
  const outline = await api("/api/chat/action", { action: "outline", item_id: art.accepted?.item_id });
  const cards = await api("/api/chat/action", { action: "flashcards", item_id: pdf.accepted?.item_id, count: 3, save: true });
  const pdfAfter = pdf.accepted?.item_id ? await item(pdf.accepted.item_id) : null;
  record("E1b", "Editor agent: outline/rewrite + active-recall flashcards (saved)", outline.json?.ok && cards.json?.ok && (pdfAfter?.flashcards ?? []).length ? "live" : outline.json?.ok || cards.json?.ok ? "partial" : "missing", {
    outline_chars: outline.json?.content_md?.length ?? 0,
    flashcards: (cards.json?.flashcards ?? []).length,
    flashcards_saved: (pdfAfter?.flashcards ?? []).length,
    errors: [outline.json?.error, cards.json?.error].filter(Boolean),
  });

  // --- E2: model switch + data_collection deny (live part: per-request model override) --------------------------------
  const models = await api("/api/models?provider=openrouter&task=chat_reasoning");
  const alt = models.json?.providers?.[0]?.models?.find((m) => /gemini|gpt|deepseek/i.test(m.model_id))?.model_id;
  const altChat = alt ? await api("/api/chat", { mode: "brain", model: `openrouter:${alt}`, messages: [{ role: "user", content: "Antworte nur mit OK." }] }) : null;
  record("E2", "Switchable models per request (catalog) + ZDR enforced (unit-tested in ai-core)", models.json?.ok && altChat?.status === 200 ? "live" : models.json?.ok ? "partial" : "missing", {
    catalog_models: models.json?.providers?.[0]?.models?.length ?? 0,
    tried_model: alt ?? null,
    alt_chat_http: altChat?.status ?? null,
    alt_chat_error: altChat?.json?.error ?? null,
  });

  // --- C5: weekly digest --------------------------------------------------------------------------------------------------
  const dg = await api("/api/digest", { days: 7, max_groups: 2 });
  const digests = (await db.from("knowledge_items").select("title,folder_path").eq("user_id", userId).eq("type", "digest")).data ?? [];
  record("C5", "Weekly project digest per cluster/folder (saved to 90_Digests)", dg.json?.ok && digests.length ? "live" : dg.json?.ok ? "partial" : "missing", {
    http: dg.status,
    digests: digests.map((d) => `${d.folder_path}/${d.title}`),
    error: dg.json?.error ?? null,
  });

  // --- 2D graph ------------------------------------------------------------------------------------------------------------
  const graph = await api("/api/graph");
  const nodes = graph.json?.nodes?.length ?? graph.json?.graph?.nodes?.length ?? 0;
  const edges = graph.json?.edges?.length ?? graph.json?.links?.length ?? graph.json?.graph?.edges?.length ?? 0;
  record("GRAPH", "2D knowledge graph from live links/wiki-links/semantics/tags", graph.status === 200 && nodes > 0 && edges > 0 ? "live" : graph.status === 200 ? "partial" : "missing", { http: graph.status, nodes, edges });

  // --- spend ----------------------------------------------------------------------------------------------------------------
  const usage = (await db.from("ai_usage").select("provider,task,cost_usd").eq("user_id", userId)).data ?? [];
  const usd = usage.reduce((s, u) => s + Number(u.cost_usd ?? 0), 0);
  record("COST", "AI spend of this audit run (metered estimate)", "info", {
    calls: usage.length,
    usd_estimate: Math.round(usd * 10000) / 10000,
    by_task: Object.fromEntries(Object.entries(usage.reduce((a, u) => ({ ...a, [u.task]: (a[u.task] ?? 0) + 1 }), {}))),
  });
} catch (err) {
  record("FATAL", "audit aborted", "error", { error: String(err) });
} finally {
  leftover = await cleanup();
}

writeFileSync(OUT, JSON.stringify({ base: BASE, started: new Date(t0).toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cleanup_rows_left: leftover, results }, null, 2));
console.log(`report: ${OUT}`);
