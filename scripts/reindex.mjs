#!/usr/bin/env node
/**
 * Re-index existing items so search and AI understand and link them (first use: the Recall
 * import of 2026-11-10). See packages/ai-core/src/reindex/reindex.ts for the three passes.
 *
 *   node scripts/reindex.mjs                 # dry run over the Recall imports: counts only
 *   node scripts/reindex.mjs --apply         # tool check, relink, embeddings
 *   node scripts/reindex.mjs --scope all     # every item instead of only Recall imports
 *   [--no-tools] [--no-links] [--no-embeddings] [--user <uuid>] [--json]
 *
 * Additive and reversible: old type/title go to metadata.reindex, links are only added.
 * Costs: one cheap model call per tool candidate (summarize route) plus embeddings.
 * Env (.env.local / .env): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KORTEX_USER_ID,
 * ANTHROPIC_API_KEY and OPENROUTER_API_KEY (only with --apply).
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { loadEnv } from "./import-recall.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const args = {
    apply: false,
    scope: "recall",
    json: false,
    user: undefined,
    passes: { tools: true, links: true, embeddings: true },
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--apply") args.apply = true;
    else if (a === "--json") args.json = true;
    else if (a === "--user") args.user = argv[++i];
    else if (a === "--scope") {
      args.scope = argv[++i];
      if (!["recall", "all"].includes(args.scope))
        throw new Error(`--scope must be recall|all, got ${args.scope}`);
    } else if (a === "--no-tools") args.passes.tools = false;
    else if (a === "--no-links") args.passes.links = false;
    else if (a === "--no-embeddings") args.passes.embeddings = false;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

async function loadModules() {
  const require = createRequire(path.join(ROOT, "packages/mcp-server/package.json"));
  const { tsImport } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
  const load = (p) => tsImport(pathToFileURL(path.join(ROOT, p)).href, import.meta.url);
  return {
    db: await load("packages/db/src/index.ts"),
    reindex: await load("packages/ai-core/src/reindex/index.ts"),
    router: await load("packages/ai-core/src/router/user-router.ts"),
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

  const { db, reindex, router } = await loadModules();
  const client = db.createKortexClient(url, key, { auth: { persistSession: false } });
  let models;
  if (args.apply) {
    ({ models } = await router.createUserModelRouter({
      client,
      userId: user,
      env: process.env,
      lockEmbeddings: false,
    }));
  }
  const report = await reindex.runReindex({
    store: reindex.createSupabaseReindexStore(client, user),
    userId: user,
    scope: args.scope,
    dryRun: !args.apply,
    passes: args.passes,
    ...(models ? { models, classify: reindex.createToolClassifier(models) } : {}),
    log: args.json ? undefined : (m) => console.log(m),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    const { tools, links } = report;
    for (const t of tools.kept) if (t.from !== t.to) console.log(`TOOL     ${t.from}  →  ${t.to}`);
    for (const t of tools.retyped) console.log(`${t.to.toUpperCase().padEnd(8)} ${t.title}`);
    for (const c of tools.collisions)
      console.log(`DOPPEL   ${c.title}  →  verlinkt mit ${c.existing}`);
    for (const e of links.examples) console.log(`LINK     ${e.title}  →  ${e.linked.join(", ")}`);
    for (const n of report.notProcessed) console.log(`OFFEN    [${n.status}] ${n.title}`);
    if (!args.apply) console.log("Dry-run: nichts geschrieben. Mit --apply ausführen.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
