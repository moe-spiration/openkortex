#!/usr/bin/env node
/**
 * Recall → Kortex über Recalls MCP-Server (nur lesend). Anders als der Markdown-Export liefert der
 * MCP-Server den vollen Inhalt jeder Karte (Artikel, Transkript); der geht mit der URL in die
 * normale Kortex-Inbox-Pipeline (kein Crawl). Titel, Tags, Ordner, Zusammenfassung macht Kortex.
 *
 *   node scripts/import-recall-mcp.mjs [--limit N] [--apply] [--all] [--user <uuid>] [--json]
 *
 * Standard: Dry-Run über die ersten 10 Karten (älteste zuerst); --limit ist auf 20 gedeckelt,
 * --all nur für den freigegebenen Vollimport. Ein zweiter Lauf legt nichts doppelt an (Dedup).
 * Env (.env.local / .env wie import-recall.mjs): RECALL_API_KEY (Recall → Settings → API & MCP),
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KORTEX_USER_ID.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv, loadModules } from "./import-recall.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RECALL_MCP_URL = "https://backend.getrecall.ai/mcp/";
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 20;

export function parseArgs(argv) {
  const args = { limit: undefined, apply: false, all: false, json: false, user: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--all") args.all = true;
    else if (a === "--json") args.json = true;
    else if (a === "--user") args.user = argv[++i];
    else if (a === "--limit") {
      const raw = argv[++i];
      if (!/^\d+$/.test(raw ?? "")) throw new Error(`--limit needs a positive integer, got ${raw}`);
      args.limit = Number(raw);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (args.all) args.limit = args.limit ?? Number.POSITIVE_INFINITY;
  else {
    args.limit = args.limit ?? DEFAULT_LIMIT;
    if (args.limit < 1) throw new Error("--limit must be at least 1");
    if (args.limit > MAX_LIMIT)
      throw new Error(
        `--limit ${args.limit} exceeds the cap of ${MAX_LIMIT} cards per run (--all only for an approved full import)`,
      );
  }
  return args;
}

/** JSON body of an MCP tool result (Recall answers with one text part holding JSON). */
export function toolJson(result) {
  if (result?.isError) {
    const msg = (result.content ?? [])
      .map((c) => c.text ?? "")
      .join(" ")
      .trim();
    throw new Error(`recall: ${msg || "tool error"}`);
  }
  if (result?.structuredContent) return result.structuredContent;
  const text = (result?.content ?? []).find((c) => c.type === "text")?.text;
  if (!text) throw new Error("recall: empty tool result");
  return JSON.parse(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait before a retry when `err` is Recall's rate limit ("… per minute … Try again in 16 seconds"), else null. */
export function rateLimitWaitMs(err) {
  const msg = String(err instanceof Error ? err.message : err);
  if (!/rate|limit|429|per minute|try again/i.test(msg)) return null;
  const s = Number(msg.match(/try again in (\d+)\s*s/i)?.[1]);
  return (Number.isFinite(s) && s > 0 ? s + 1 : 20) * 1000;
}

/** Every page of a paged Recall tool, merged by `merge`. */
export async function allPages(call, args, merge, maxPages = 500) {
  let acc;
  let cursor = null;
  for (let n = 0; n < maxPages; n++) {
    const page = await call({ ...args, ...(cursor ? { cursor } : {}) });
    acc = merge(acc, page);
    if (!page.has_more || !page.next_cursor) return acc;
    cursor = page.next_cursor;
  }
  throw new Error("recall: too many pages");
}

/** Card ids, oldest first (a re-run with the same limit sees the same cards). */
export async function listCards(call, limit) {
  const out = [];
  let cursor = null;
  while (out.length < limit) {
    const page = await call("filter_by_metadata", {
      sort_order: "asc",
      limit: Math.min(500, Number.isFinite(limit) ? limit : 500),
      ...(cursor ? { cursor } : {}),
    });
    for (const c of page.cards ?? page.results ?? page.items ?? []) {
      if (out.length >= limit) break;
      out.push(c);
    }
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

/** The whole saved content of one card (all fetch pages). */
export async function fetchCard(call, id) {
  return allPages(
    (a) => call("fetch", a),
    { id, part: "content" },
    (acc, page) =>
      acc
        ? { ...acc, text: `${acc.text}${page.text ?? ""}` }
        : { id: page.id ?? id, title: page.title, text: page.text ?? "", metadata: page.metadata },
  );
}

async function connect(apiKey) {
  const require = createRequire(path.join(ROOT, "packages/mcp-server/package.json"));
  const { Client } = await import(
    pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href
  );
  const { StreamableHTTPClientTransport } = await import(
    pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")).href
  );
  const client = new Client({ name: "kortex-import", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(RECALL_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    }),
  );
  let last = 0;
  const call = async (name, args) => {
    for (let attempt = 0; ; attempt++) {
      // 180 calls/min per account: keep at most ~150/min.
      const gap = last + 400 - Date.now();
      if (gap > 0) await sleep(gap);
      last = Date.now();
      try {
        return toolJson(await client.callTool({ name, arguments: args }));
      } catch (err) {
        const wait = rateLimitWaitMs(err);
        if (attempt < 6 && wait != null) {
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
  };
  return { client, call };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  const apiKey = process.env.RECALL_API_KEY;
  const user = args.user ?? process.env.KORTEX_USER_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey) throw new Error("RECALL_API_KEY is missing (Recall → Settings → API & MCP)");
  if (!url || !key || !user)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and --user/KORTEX_USER_ID are required",
    );

  const { db, importers } = await loadModules();
  importers.resolveImportLimit(Number.isFinite(args.limit) ? args.limit : undefined, args.all);
  const recall = await connect(apiKey);
  const files = [];
  try {
    for (const c of await listCards(recall.call, args.limit)) {
      const card = await fetchCard(recall.call, c.id);
      card.title ??= c.title;
      card.metadata = {
        source_url: c.source_url,
        created_at: c.created_at,
        image: c.image,
        ...card.metadata,
      };
      files.push({ file: `recall:${c.id}`, text: JSON.stringify(card) });
    }
  } finally {
    await recall.client.close().catch(() => {});
  }

  const client = db.createKortexClient(url, key, { auth: { persistSession: false } });
  const store = importers.createSupabaseImportStore(client, user, randomUUID);
  const report = await importers.runImport(files, store, {
    importer: importers.IMPORTERS["recall-mcp"],
    platform: "recall",
    userId: user,
    apply: args.apply,
    uuid: randomUUID,
  });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    const { entries, ...summary } = report;
    for (const e of entries) {
      const what =
        e.action === "new"
          ? `NEW  ${e.type}${e.prefetched ? " +Inhalt" : e.recrawl ? " +Crawl" : e.queued ? " +KI" : ""}`
          : e.action === "duplicate"
            ? `DUP  (${e.reason})`
            : e.action === "skipped"
              ? `SKIP (${e.reason})`
              : `ERR  ${e.error}`;
      console.log(`${what.padEnd(28)} ${e.title ?? e.file}${e.id ? `  [${e.id}]` : ""}`);
    }
    console.log(summary);
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
