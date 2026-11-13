#!/usr/bin/env node
/**
 * Backfill der Dedup-Spalten für Bestandsdaten (S2): `knowledge_items.source_url_norm` und `content_hash`.
 * Idempotent (nur NULL-Werte werden gefüllt), standardmäßig Dry-Run. Nichts wird gelöscht oder gemergt:
 * Duplikat-Gruppen werden nur berichtet (der älteste Eintrag bekommt den URL-Schlüssel, die anderen
 * bleiben ohne, damit der partielle UNIQUE-Index nicht verletzt wird).
 *
 *   node scripts/dedup-backfill.mjs [--user <uuid>] [--dry-run | --apply] [--json]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL (oder SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, KORTEX_USER_ID (Default für --user).
 * Die Logik (urlKey, contentHash) kommt aus packages/db/src/dedup.ts, derselben Quelle wie alle Eingänge.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = 500;

/**
 * Pure plan over the user's rows (oldest first). `lib` = { urlKey, contentHash } from @kortex/db.
 * Returns the column updates and the duplicate groups (URL key held by more than one row; equal hashes).
 */
export async function planBackfill(rows, lib) {
  const updates = [];
  const byNorm = new Map();
  const byHash = new Map();
  // Keys already in the DB claim their slot first.
  for (const r of rows) if (r.source_url_norm) byNorm.set(r.source_url_norm, [r.id]);
  for (const r of rows) {
    const patch = {};
    const answer = r.type === "ai_chat" && r.metadata?.scope === "answer";
    const norm = r.source_url_norm ?? (answer ? null : lib.urlKey(r.source_url));
    if (norm && !r.source_url_norm) {
      const holders = byNorm.get(norm);
      if (holders) holders.push(r.id);
      else {
        byNorm.set(norm, [r.id]);
        patch.source_url_norm = norm;
      }
    }
    // Uploads are hashed over their bytes at ingest; the backfill only hashes text.
    const hash =
      r.content_hash ?? (r.source_platform === "upload" ? null : await lib.contentHash(r.content_md));
    if (hash && !r.content_hash) patch.content_hash = hash;
    if (hash) byHash.set(`${r.type}:${hash}`, [...(byHash.get(`${r.type}:${hash}`) ?? []), r.id]);
    if (Object.keys(patch).length) updates.push({ id: r.id, patch });
  }
  const groups = (m) => [...m].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
  return { updates, urlDuplicates: groups(byNorm), hashDuplicates: groups(byHash) };
}

async function loadDb() {
  const require = createRequire(path.join(ROOT, "packages/mcp-server/package.json"));
  const { tsImport } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
  return tsImport(pathToFileURL(path.join(ROOT, "packages/db/src/index.ts")).href, import.meta.url);
}

function parseArgs(argv) {
  const args = { apply: false, json: false, user: process.env.KORTEX_USER_ID };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--dry-run") args.apply = false;
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--user") args.user = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !args.user)
    throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and --user/KORTEX_USER_ID are required");
  const db = await loadDb();
  const client = db.createKortexClient(url, key, { auth: { persistSession: false } });
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("knowledge_items")
      .select("id,type,source_url,source_platform,content_md,metadata,source_url_norm,content_hash,created_at")
      .eq("user_id", args.user)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load items: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const plan = await planBackfill(rows, db);
  if (args.apply) {
    for (const u of plan.updates) {
      const { error } = await client
        .from("knowledge_items")
        .update(u.patch)
        .eq("user_id", args.user)
        .eq("id", u.id);
      // A concurrent capture took the URL key meanwhile: keep going, the next run reports it.
      if (error && !db.isSourceUrlConflict(error)) throw new Error(`update ${u.id}: ${error.message}`);
    }
  }
  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    items: rows.length,
    updates: plan.updates.length,
    url_duplicate_groups: plan.urlDuplicates.length,
    hash_duplicate_groups: plan.hashDuplicates.length,
  };
  if (args.json) console.log(JSON.stringify({ summary, ...plan }, null, 2));
  else {
    console.log(summary);
    for (const g of plan.urlDuplicates) console.log(`URL duplicate ${g.key}: ${g.ids.join(", ")}`);
    for (const g of plan.hashDuplicates) console.log(`content duplicate ${g.key}: ${g.ids.join(", ")}`);
    if (!args.apply) console.log("Dry-run: nothing written. Re-run with --apply to fill the columns.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
