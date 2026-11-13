#!/usr/bin/env node
/**
 * Backfill der Inhaltsqualität (Release 0.6.0, Sektion B) für Bestandsdaten. Standardmäßig Dry-Run,
 * es wird NIE etwas gelöscht:
 *   1. Transkripte (`<details>`-Rohtranskript, `## Transkript`, `## Vollständiges Transkript`) werden ans
 *      Ende gestellt und in `> [!toggle]- Transkript` umgebaut (Editor-Format, packages/ui/src/editor/README.md).
 *   2. Leere Sektionen ("- Keine") und Platzhaltersätze ("Kein Transkript verfügbar") fallen weg.
 *   3. Falsche Typen werden nachgezogen: URL-Regeln und Tag-Hinweise aus der Typ-Registry
 *      (article/bookmark/note → book/movie/video/…). Manuell platzierte Items behalten ihren Ordner.
 *   4. Whisper-Halluzinationen ("Untertitel der Amara.org-Community") werden nur aufgelistet.
 *
 *   node scripts/backfill-content.mjs [--user <uuid>] [--apply] [--json] [--out <datei>]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL (oder SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, KORTEX_USER_ID (Default für --user).
 * Typ-Regeln: packages/db/src/type-registry.ts; Halluzinationsliste: packages/ai-core/src/audio/hallucination.ts.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = 500;
const TOGGLE_TITLE = "> [!toggle]- Transkript";
const RETYPABLE = new Set(["note", "article", "bookmark"]);
const TAG_TYPES = ["movie", "book", "product", "place", "receipt", "snippet", "inspiration"];
const URL_MIN_CONFIDENCE = 0.85;
const TRANSCRIPT_HEADINGS = /^## (?:(?:Vollständiges )?Transkript|(?:Full )?Transcript)\s*$/;
const PLACEHOLDER_LINE = /^>?\s*(?:Kein Transkript verfügbar|No transcript available)[^\n]*$/;

/** Quotes lines as a toggle body; consecutive plain lines get a bare `>` between them (own paragraph). */
export function toggleBlock(lines) {
  const body = [...lines];
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body.at(-1).trim()) body.pop();
  if (!body.length) return [];
  const out = [TOGGLE_TITLE, ">"];
  let prevPlain = false;
  for (const l of body) {
    if (!l.trim()) {
      out.push(">");
      prevPlain = false;
      continue;
    }
    const heading = /^#{1,6}\s/.test(l);
    if (prevPlain && !heading) out.push(">");
    out.push(`> ${l}`);
    prevPlain = !heading;
  }
  return out;
}

/** Removes sections that only say "Keine" and placeholder sentences. */
export function dropEmptySections(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (PLACEHOLDER_LINE.test(lines[i].trim())) continue;
    if (/^## /.test(lines[i])) {
      let j = i + 1;
      const body = [];
      while (j < lines.length && !/^## /.test(lines[j])) body.push(lines[j++]);
      const text = body.filter((l) => l.trim()).map((l) => l.trim());
      if (text.length && text.every((l) => /^- Keine\.?$/.test(l))) {
        i = j - 1;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Moves the transcript to the very end as a folded toggle. Idempotent. */
export function convertTranscript(md) {
  let text = md.replace(/\r\n/g, "\n");
  if (text.includes(TOGGLE_TITLE)) return dropEmptySections(text).trim();
  let transcript = null;

  const details = /\n*<details>\s*\n<summary>[^<]*<\/summary>\s*\n([\s\S]*?)\n<\/details>[ \t]*/i.exec(text);
  if (details) {
    transcript = details[1].replace(/&lt;\/details&gt;/g, "</details>").split("\n");
    text = text.replace(details[0], "\n");
  } else {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => TRANSCRIPT_HEADINGS.test(l));
    if (at >= 0) {
      let end = at + 1;
      while (end < lines.length && !/^## /.test(lines[end])) end++;
      transcript = lines.slice(at + 1, end);
      let start = at;
      // The rule that used to separate the synthesis from the transcript goes along.
      let k = at - 1;
      while (k >= 0 && !lines[k].trim()) k--;
      if (k >= 0 && lines[k].trim() === "---") start = k;
      lines.splice(start, end - start);
      text = lines.join("\n");
    }
  }
  const cleaned = dropEmptySections(text).trim();
  if (!transcript || !transcript.some((l) => l.trim())) return cleaned;
  return `${cleaned}\n\n${toggleBlock(transcript).join("\n")}`.trim();
}

/** Type a generic item really is: URL rule (confident), else the tags. null = leave it. */
export function planType(row, lib) {
  if (!RETYPABLE.has(row.type)) return null;
  const byUrl = lib.typeFromUrl(row.source_url);
  if (byUrl && byUrl.confidence >= URL_MIN_CONFIDENCE) {
    return byUrl.type === row.type ? null : { type: byUrl.type, reason: `url:${byUrl.rule}` };
  }
  // A tag never makes a video or a podcast, only the types the typed extraction knows.
  const byTag = lib.typeFromTags(row.tags ?? []);
  return byTag && TAG_TYPES.includes(byTag) ? { type: byTag, reason: "tag" } : null;
}

/** Whisper artefacts: apart from the title the body is only known phrases, or it mentions amara.org. */
export function isHallucinatedEntry(row, lib) {
  const body = (row.content_md ?? "")
    .split("\n")
    .filter((l) => !/^# /.test(l))
    .map((l) => l.replace(/^[>#\s-]+/, "").trim())
    .filter((l) => l && !/^\[!toggle\]/.test(l));
  if (/amara\.org/i.test(row.content_md ?? "")) return true;
  const real = body.filter((l) => !lib.isWhisperHallucination(l));
  return body.length > 0 && real.length === 0 && body.some((l) => lib.isWhisperHallucination(l));
}

/** Pure plan over the user's rows. `lib` = { typeFromUrl, typeFromTags, isWhisperHallucination }. */
export function planContentBackfill(rows, lib) {
  const transcripts = [];
  const types = [];
  const hallucinations = [];
  for (const r of rows) {
    const md = (r.content_md ?? "").replace(/\r\n/g, "\n");
    const next = convertTranscript(md);
    if (next !== md.trim()) transcripts.push({ id: r.id, title: r.title, content_md: next });
    const t = planType(r, lib);
    if (t) types.push({ id: r.id, title: r.title, from: r.type, ...t, manual: !!r.is_manual_placement });
    if (isHallucinatedEntry(r, lib)) hallucinations.push({ id: r.id, title: r.title, type: r.type });
  }
  return { transcripts, types, hallucinations };
}

async function loadLib() {
  const require = createRequire(path.join(ROOT, "packages/mcp-server/package.json"));
  const { tsImport } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
  const load = (p) => tsImport(pathToFileURL(path.join(ROOT, p)).href, import.meta.url);
  const db = await load("packages/db/src/index.ts");
  const hall = await load("packages/ai-core/src/audio/hallucination.ts");
  return { ...db, isWhisperHallucination: hall.isWhisperHallucination };
}

function parseArgs(argv) {
  const args = { apply: false, json: false, user: process.env.KORTEX_USER_ID, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--dry-run") args.apply = false;
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--user") args.user = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
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
  const lib = await loadLib();
  const client = lib.createKortexClient(url, key, { auth: { persistSession: false } });
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("knowledge_items")
      .select("id,type,title,source_url,content_md,tags,metadata,folder_path,is_manual_placement,created_at")
      .eq("user_id", args.user)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load items: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const plan = planContentBackfill(rows, lib);

  if (args.apply) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const patches = new Map();
    for (const t of plan.transcripts) patches.set(t.id, { content_md: t.content_md });
    for (const t of plan.types) {
      const row = byId.get(t.id);
      const patch = patches.get(t.id) ?? {};
      patch.type = t.type;
      patch.metadata = { ...(row.metadata ?? {}), retyped_from: row.type, retyped_by: t.reason };
      const folder = lib.typeDefinition(t.type)?.folder;
      if (folder && !row.is_manual_placement) patch.folder_path = folder;
      patches.set(t.id, patch);
    }
    for (const [id, patch] of patches) {
      const { error } = await client.from("knowledge_items").update(patch).eq("user_id", args.user).eq("id", id);
      if (error) throw new Error(`update ${id}: ${error.message}`);
    }
  }

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    items: rows.length,
    transcripts_to_toggle: plan.transcripts.length,
    types_to_fix: plan.types.length,
    hallucinated_entries_listed: plan.hallucinations.length,
  };
  const report = args.json
    ? JSON.stringify({ summary, ...plan, transcripts: plan.transcripts.map(({ id, title }) => ({ id, title })) }, null, 2)
    : [
        JSON.stringify(summary),
        ...plan.transcripts.map((t) => `transcript → toggle: ${t.id}  ${t.title}`),
        ...plan.types.map(
          (t) => `type ${t.from} → ${t.type} (${t.reason}${t.manual ? ", manual folder kept" : ""}): ${t.id}  ${t.title}`,
        ),
        ...plan.hallucinations.map((h) => `Amara/Whisper entry (NOT deleted): ${h.id}  [${h.type}] ${h.title}`),
        args.apply
          ? ""
          : "Dry-run: nothing written. Re-run with --apply to write transcripts and types (hallucinated entries are never touched).",
      ].join("\n");
  if (args.out) fs.writeFileSync(args.out, `${report}\n`, "utf8");
  else console.log(report);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
