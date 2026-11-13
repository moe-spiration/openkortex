#!/usr/bin/env node
// TEMPORARY test account for the emulator run (Android QA). Never touches other accounts.
//
//   node --env-file=../web/.env.local scripts/test-user.mjs create  <creds.json>
//   node --env-file=../web/.env.local scripts/test-user.mjs check   <creds.json>   (what the account holds now)
//   node --env-file=../web/.env.local scripts/test-user.mjs cleanup <creds.json>   (delete + verify 0 rows)
//
// create: admin API (service role) makes a confirmed user, adds it to kortex.allowed_users, bootstraps the
// workspace and seeds two notes. The credentials go to <creds.json> (keep it outside the repo), never to stdout.
// cleanup: deletes exactly that user id and counts the rows left in every kortex table that carries user_id.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [mode, file] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!mode || !file || !url || !anon || !service) {
  console.error("usage: test-user.mjs create|check|cleanup <creds.json>; needs the Supabase env of apps/web");
  process.exit(2);
}
const opts = { db: { schema: "kortex" }, auth: { persistSession: false } };
const admin = createClient(url, service, opts);
const TABLES = ["allowed_users", "knowledge_items", "item_chunks", "folders", "tags", "action_items", "user_settings"];

async function counts(userId) {
  const out = {};
  for (const t of TABLES) {
    const r = await admin.from(t).select("*", { count: "exact", head: true }).eq("user_id", userId);
    out[t] = r.error ? `error(${r.error.message})` : r.count;
  }
  return out;
}

if (mode === "create") {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const email = `kortex-android+${day}-${randomBytes(3).toString("hex")}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`createUser: ${made.error?.message}`);
  const userId = made.data.user.id;
  writeFileSync(file, JSON.stringify({ email, password, userId }));
  const allow = await admin.from("allowed_users").insert({ user_id: userId, email, role: "member", note: "temporary Android QA user, deleted afterwards" });
  if (allow.error) throw new Error(`allowlist: ${allow.error.message}`);
  const user = createClient(url, anon, opts);
  const login = await user.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error(`login: ${login.error.message}`);
  const boot = await user.rpc("bootstrap_user");
  if (boot.error) throw new Error(`bootstrap_user: ${boot.error.message}`);
  const seed = [
    { title: "Android QA: Notiz vom Server", content_md: "# Android QA\n\nDiese Notiz wurde serverseitig angelegt und soll in der App erscheinen.\n", tags: ["#kortex"] },
    { title: "Android QA: zweite Notiz", content_md: "# Zweite Notiz\n\nMit [[Android QA: Notiz vom Server]] verknüpft.\n", tags: ["#ai/mcp"] },
    // G4: a starred note with a checklist (Favoriten view, checkboxes in the detail sheet) and an archived one.
    {
      title: "Android QA: Favorit mit Checkliste",
      content_md: "# Packliste\n\n- [x] Ladekabel\n- [ ] Ausweis\n  - [ ] Kopie\n- [ ] Kamera\n",
      tags: ["#kortex"],
      is_favorite: true,
    },
    { title: "Android QA: archivierte Notiz", content_md: "# Alt\n\nDiese Notiz liegt im Archiv.\n", tags: ["#kortex"], status: "archived", metadata: { status_before_archive: "processed" } },
  ].map((n) => ({
    id: randomUUID(),
    user_id: userId,
    type: "note",
    source_platform: "manual",
    status: "processed",
    slug: n.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    ...n,
  }));
  const ins = await admin.from("knowledge_items").insert(seed);
  if (ins.error) throw new Error(`seed: ${ins.error.message}`);
  console.log(`created temporary user ${userId} (credentials in ${file}); rows: ${JSON.stringify(await counts(userId))}`);
} else if (mode === "check") {
  const { userId } = JSON.parse(readFileSync(file, "utf8"));
  console.log(JSON.stringify(await counts(userId)));
  const items = await admin.from("knowledge_items").select("type,title,source_platform,created_at").eq("user_id", userId).order("created_at", { ascending: false });
  for (const i of items.data ?? []) console.log(`- ${i.type} | ${i.title} | ${i.source_platform}`);
} else if (mode === "cleanup") {
  const { userId } = JSON.parse(readFileSync(file, "utf8"));
  const del = await admin.auth.admin.deleteUser(userId);
  console.log(del.error ? `deleteUser failed: ${del.error.message}` : `deleted user ${userId}`);
  const c = await counts(userId);
  const clean = Object.values(c).every((n) => n === 0);
  console.log(`${clean ? "PASS" : "FAIL"} no rows left for the test user: ${JSON.stringify(c)}`);
  process.exit(clean && !del.error ? 0 : 1);
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
