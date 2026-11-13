// Vault completeness: every knowledge item must have a corresponding .md file in the vault (portable Markdown rule).
//   node scripts/vault-completeness.mjs [--vault <dir>] [--user <uuid>] [--json]
//
// Core (pure): findMissingFiles(items, files). An item is covered when a file carries its id in the frontmatter,
// or (fallback) a file sits at <folder_path>/<slug>.md. CLI: needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL),
// SUPABASE_SERVICE_ROLE_KEY and KORTEX_USER_ID/--user; the vault is --vault, KORTEX_VAULT_PATH or ~/KortexVault.
// Without that env (or without a vault directory) it prints a skip message and exits 0, so the check passes anywhere.
// Exit 1 only when items without a .md were found.
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PAGE = 1000;

/** `id: <uuid>` from the YAML frontmatter block of a Markdown text, or null. */
export function frontmatterId(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const id = /^id:\s*["']?([^\s"']+)["']?\s*$/m.exec(m[1]);
  return id ? id[1] : null;
}

const norm = (p) => p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();

/**
 * @param {{id: string, title?: string, slug?: string | null, folder_path?: string | null}[]} items DB rows
 * @param {{rel: string, id?: string | null}[]} files vault files (rel = path relative to the vault, id = frontmatter id)
 * @returns {{checked: number, missing: {id: string, title: string | null, expected: string | null}[]}}
 */
export function findMissingFiles(items, files) {
  const ids = new Set(files.map((f) => f.id).filter(Boolean));
  const rels = new Set(files.map((f) => norm(f.rel)));
  const missing = [];
  for (const it of items) {
    if (ids.has(it.id)) continue;
    const expected = it.slug ? `${it.folder_path ? `${it.folder_path}/` : ""}${it.slug}.md` : null;
    if (expected && rels.has(norm(expected))) continue;
    missing.push({ id: it.id, title: it.title ?? null, expected });
  }
  return { checked: items.length, missing };
}

async function walk(dir, root, out) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) await walk(abs, root, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md") && !e.name.endsWith(".conflict.md")) {
      out.push({ rel: relative(root, abs).split(sep).join("/"), id: frontmatterId(await readFile(abs, "utf8")) });
    }
  }
  return out;
}

export function parseArgs(argv, env = process.env) {
  const args = {
    vault: env.KORTEX_VAULT_PATH || join(homedir(), "KortexVault"),
    user: env.KORTEX_USER_ID,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vault") args.vault = argv[++i];
    else if (argv[i] === "--user") args.user = argv[++i];
    else if (argv[i] === "--json") args.json = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

async function loadItems(url, key, user) {
  // Same loader as scripts/dedup-backfill.mjs: the typed Kortex client from packages/db.
  const require = createRequire(join(ROOT, "packages/mcp-server/package.json"));
  const { tsImport } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
  const db = await tsImport(pathToFileURL(join(ROOT, "packages/db/src/index.ts")).href, import.meta.url);
  const client = db.createKortexClient(url, key, { auth: { persistSession: false } });
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("knowledge_items")
      .select("id,title,slug,folder_path")
      .eq("user_id", user)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load items: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, env);
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !args.user) {
    console.log("vault-completeness: skipped (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KORTEX_USER_ID not all set)");
    return 0;
  }
  const isDir = await stat(args.vault).then((s) => s.isDirectory(), () => false);
  if (!isDir) {
    console.log(`vault-completeness: skipped (no vault directory at ${args.vault})`);
    return 0;
  }
  const [items, files] = await Promise.all([loadItems(url, key, args.user), walk(args.vault, args.vault, [])]);
  const res = findMissingFiles(items, files);
  if (args.json) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(`vault-completeness: ${res.checked} items, ${files.length} files, ${res.missing.length} without .md`);
    for (const m of res.missing) console.log(`  missing ${m.id}  ${m.title ?? ""}  (${m.expected ?? "no slug"})`);
  }
  return res.missing.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
