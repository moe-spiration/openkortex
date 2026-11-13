#!/usr/bin/env node
/**
 * Recall-Import (S13): Recall-Markdown-Export (.md mit YAML-Frontmatter) → kortex.knowledge_items.
 * Standardmäßig Dry-Run (zeigt den Plan). Liest den Export-Ordner nur, ändert dort nichts.
 *
 *   node scripts/import-recall.mjs <ordner> [--limit N] [--apply] [--user <uuid>] [--ai content|all|none] [--no-recrawl] [--with-objects] [--json]
 *
 * --limit: Standard 10, hart gedeckelt auf 20 (mehr nur mit --all, für einen freigegebenen Vollimport).
 * --ai:    content (Standard) = KI-Pipeline nur für Karten mit eigenem Text; all; none.
 * Env (aus .env.local/.env der Repo-Wurzel bzw. des Haupt-Checkouts): NEXT_PUBLIC_SUPABASE_URL (oder
 * SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, KORTEX_USER_ID (Default für --user).
 * Logik (Parser, Dedup, Insert, Ingest-Job) kommt aus packages/ai-core/src/importers und
 * packages/db/src/dedup.ts, derselben Quelle wie alle anderen Eingänge.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 20;

/** Env files of this checkout, then of the main checkout (worktrees have no .env.local). */
export function loadEnv() {
  const roots = [ROOT];
  try {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    roots.push(path.dirname(common));
  } catch {
    // not a git checkout: only ROOT
  }
  for (const r of roots)
    for (const f of [".env.local", ".env"]) {
      const p = path.join(r, f);
      if (existsSync(p)) process.loadEnvFile(p);
    }
}

export function parseArgs(argv) {
  const args = {
    folder: null,
    limit: undefined,
    apply: false,
    all: false,
    json: false,
    ai: "content",
    recrawl: true,
    objects: false,
    user: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--all") args.all = true;
    else if (a === "--json") args.json = true;
    else if (a === "--no-recrawl") args.recrawl = false;
    else if (a === "--with-objects") args.objects = true;
    else if (a === "--user") args.user = argv[++i];
    else if (a === "--ai") args.ai = argv[++i];
    else if (a === "--limit") {
      const raw = argv[++i];
      if (!/^\d+$/.test(raw ?? "")) throw new Error(`--limit needs a positive integer, got ${raw}`);
      args.limit = Number(raw);
    } else if (a.startsWith("--")) throw new Error(`unknown argument ${a}`);
    else if (!args.folder) args.folder = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!args.folder)
    throw new Error("usage: import-recall.mjs <folder> [--limit N] [--apply] [--user <uuid>]");
  if (!["content", "all", "none"].includes(args.ai))
    throw new Error(`--ai must be content|all|none, got ${args.ai}`);
  if (args.all) args.limit = args.limit ?? Number.POSITIVE_INFINITY;
  else {
    args.limit = args.limit ?? DEFAULT_LIMIT;
    if (args.limit < 1) throw new Error("--limit must be at least 1");
    if (args.limit > MAX_LIMIT)
      throw new Error(
        `--limit ${args.limit} exceeds the cap of ${MAX_LIMIT} files per run (--all only for an approved full import)`,
      );
  }
  return args;
}

/** The first `limit` .md files of the folder, sorted by name (deterministic: a re-run sees the same files). */
export function selectFiles(names, limit) {
  return names
    .filter((n) => /\.md$/i.test(n) && !/\.conflict(-[^.]*)?\.md$/i.test(n))
    .sort((a, b) => a.localeCompare(b, "en"))
    .slice(0, limit);
}

export async function loadModules() {
  const require = createRequire(path.join(ROOT, "packages/mcp-server/package.json"));
  const { tsImport } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
  const load = (p) => tsImport(pathToFileURL(path.join(ROOT, p)).href, import.meta.url);
  return {
    db: await load("packages/db/src/index.ts"),
    importers: await load("packages/ai-core/src/importers/index.ts"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  const user = args.user ?? process.env.KORTEX_USER_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !user)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and --user/KORTEX_USER_ID are required",
    );
  const folder = path.resolve(args.folder);
  if (!statSync(folder).isDirectory()) throw new Error(`${folder} is not a directory`);

  const { db, importers } = await loadModules();
  importers.resolveImportLimit(Number.isFinite(args.limit) ? args.limit : undefined, args.all);
  const names = selectFiles(readdirSync(folder), args.limit);
  // Read-only access to the export folder.
  const files = names.map((file) => ({
    file,
    text: readFileSync(path.join(folder, file), "utf8"),
  }));

  const client = db.createKortexClient(url, key, { auth: { persistSession: false } });
  const store = importers.createSupabaseImportStore(client, user, randomUUID);
  const report = await importers.runImport(files, store, {
    importer: importers.IMPORTERS.recall,
    userId: user,
    apply: args.apply,
    ai: args.ai,
    recrawl: args.recrawl,
    objects: args.objects,
    uuid: randomUUID,
  });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    const { entries, ...summary } = report;
    for (const e of entries) {
      const what =
        e.action === "new"
          ? `NEW  ${e.type}${e.recrawl ? " +Crawl" : e.queued ? " +KI" : ""}`
          : e.action === "duplicate"
            ? `DUP  (${e.reason})`
            : e.action === "skipped"
              ? `SKIP (${e.reason})`
            : `ERR  ${e.error}`;
      console.log(`${what.padEnd(28)} ${e.title ?? e.file}${e.id ? `  [${e.id}]` : ""}`);
    }
    console.log({ folder, ...summary });
    if (!args.apply) console.log("Dry-run: nothing written. Re-run with --apply to import.");
  }
  if (report.errors > 0) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
