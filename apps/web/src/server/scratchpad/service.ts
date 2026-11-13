import { byLocale } from "@kortex/i18n";
import { t } from "@/i18n";
import { createHash } from "node:crypto";
import { generateText, Output } from "ai";
import { modelFor, type ModelRouter } from "@kortex/ai-core";
import { badRequest } from "../api-error";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import { createNoteFor } from "../notes/service";
import { appendToObjectTarget, createNoteTarget, createTaskTarget } from "./targets";
import { getItem, mergeJson, updateItem } from "../repo";
import {
  appendArchive,
  appendEntry,
  archiveInitialDoc,
  SCRATCHPAD_ARCHIVE_FOLDER,
  SCRATCHPAD_ARCHIVE_TITLE,
  initialDoc,
  parseEntries,
  removeEntries,
  SCRATCHPAD_FOLDER,
  SCRATCHPAD_TITLE,
  stamp,
  type ScratchEntry,
} from "./format";
import { CleanupOutputSchema, OBJECT_KINDS, type Decision, type Suggestion } from "./schema";

/*
 * The scratchpad is ONE item per user. Its id is derived from the user id, so two parallel first
 * entries hit the same primary key: the loser reads the winner's row (no second document).
 * Appends and removals compare-and-swap on content_md and retry, so parallel writers keep their entries.
 */

export const scratchpadId = (userId: string): string => {
  const h = createHash("sha256").update(`kortex-scratchpad:${userId}`).digest("hex");
  // UUID-shaped: version nibble 5, variant nibble a
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export const scratchpadArchiveId = (userId: string): string => {
  const h = createHash("sha256").update(`kortex-scratchpad-archive:${userId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

type Ctx = Pick<AuthContext, "client" | "userId">;
const COLS = ["id", "content_md"] as const;

export async function getScratchpad(ctx: Ctx) {
  return getItem(ctx.client, ctx.userId, scratchpadId(ctx.userId), COLS);
}

/** Creates the document when missing; safe under races. */
export async function ensureScratchpad(ctx: Ctx): Promise<{ id: string }> {
  const id = scratchpadId(ctx.userId);
  if (await getScratchpad(ctx)) return { id };
  try {
    await createNoteFor(ctx, { id, title: SCRATCHPAD_TITLE, contentMd: initialDoc(), folderPath: SCRATCHPAD_FOLDER });
    await updateItem(ctx.client, ctx.userId, id, { metadata: mergeJson(null, { scratchpad: true }) });
  } catch (err) {
    // Lost the race (same primary key): the winner's row is the document.
    if (!(await getScratchpad(ctx))) throw err;
  }
  return { id };
}

/**
 * Appends cleaned-up entries to the Markdown archive note (created on first use). Returns false when the archive
 * could not be written (W-03): the caller then keeps the entries in the pad instead of losing them.
 */
async function archiveEntries(ctx: Ctx, entries: readonly ScratchEntry[]): Promise<boolean> {
  if (!entries.length) return true;
  try {
    const id = scratchpadArchiveId(ctx.userId);
    if (!(await getItem(ctx.client, ctx.userId, id, COLS))) {
      try {
        await createNoteFor(ctx, {
          id,
          title: SCRATCHPAD_ARCHIVE_TITLE,
          contentMd: archiveInitialDoc(),
          folderPath: SCRATCHPAD_ARCHIVE_FOLDER,
        });
        await updateItem(ctx.client, ctx.userId, id, { metadata: mergeJson(null, { scratchpad_archive: true }) });
      } catch (err) {
        if (!(await getItem(ctx.client, ctx.userId, id, COLS))) throw err;
      }
    }
    await swap(ctx, id, (m) => appendArchive(m, entries));
    return true;
  } catch (err) {
    console.error("scratchpad archive failed", err);
    return false;
  }
}

async function swap(ctx: Ctx, id: string, edit: (md: string) => string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await getItem(ctx.client, ctx.userId, id, COLS);
    if (!cur) throw badRequest(t("Scratchpad not found"));
    const before = cur.content_md ?? "";
    const next = edit(before);
    if (next === before) return before;
    const { data, error } = await ctx.client
      .from("knowledge_items")
      .update({ content_md: next })
      .eq("user_id", ctx.userId)
      .eq("id", id)
      .eq("content_md", before)
      .select("id");
    if (error) throw new Error(`update scratchpad: ${error.message}`);
    if (data && data.length) return next;
  }
  throw new Error(t("The Scratchpad is being changed elsewhere right now, please try again"));
}

export async function listEntries(ctx: Ctx): Promise<{ item_id: string | null; entries: ScratchEntry[] }> {
  const row = await getScratchpad(ctx);
  return { item_id: row ? row.id : null, entries: row ? parseEntries(row.content_md ?? "") : [] };
}

export async function appendToScratchpad(deps: Pick<ServerDeps, "now">, ctx: Ctx, text: string) {
  const clean = text.replace(/\s+$/, "");
  if (!clean.trim()) throw badRequest(t("Empty entry"));
  const { id } = await ensureScratchpad(ctx);
  const at = stamp(deps.now());
  const md = await swap(ctx, id, (m) => appendEntry(m, { at, text: clean }));
  const entries = parseEntries(md);
  return { item_id: id, entries, entry: entries.filter((e) => e.at === at && e.text === clean).pop() ?? null };
}

// --- AI cleanup ------------------------------------------------------------------------------

const cleanupSystem = (): string =>
  byLocale({
    en: `You sort the entries of a Scratchpad (quick ideas). Choose exactly one action per entry:
- "note": knowledge or note content that should stay as a note of its own (title = short title).
- "task": a task (title = the task as a short imperative).
- "object": belongs to an existing person or object from the list (target_item_id = exactly one id from the list).
- "discard": worthless, duplicate or done.
- "keep": unclear, leave it in the Scratchpad.
Every entry gets exactly one suggestion with its entry_id. Do not invent ids. Language: English. reason: one short sentence.`,
    de: `Du sortierst Einträge eines Scratchpads (schnelle Einfälle). Wähle je Eintrag genau eine Aktion:
- "note": ein Wissens-/Notizinhalt, der als eigene Notiz bleiben soll (title = kurzer Titel).
- "task": eine Aufgabe (title = Aufgabe als kurzer Imperativ).
- "object": gehört zu einer vorhandenen Person oder einem Objekt aus der Liste (target_item_id = genau eine id aus der Liste).
- "discard": wertlos, doppelt oder erledigt.
- "keep": unklar, im Scratchpad lassen.
Jeder Eintrag bekommt genau einen Vorschlag mit seiner entry_id. Erfinde keine ids. Sprache: Deutsch. reason: ein kurzer Satz.`,
  });

const CANDIDATE_LIMIT = 100;

export async function loadObjectCandidates(ctx: Ctx) {
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id,title,type")
    .eq("user_id", ctx.userId)
    .in("type", [...OBJECT_KINDS])
    .order("updated_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw new Error(`load objects: ${error.message}`);
  return (data ?? []) as { id: string; title: string; type: string }[];
}

/** Model output → one valid suggestion per entry; unknown ids dropped, bad targets become `keep`. */
export function sanitizeSuggestions(
  raw: readonly Suggestion[],
  entries: readonly ScratchEntry[],
  targets: ReadonlySet<string>,
): Suggestion[] {
  const known = new Set(entries.map((e) => e.id));
  const byId = new Map<string, Suggestion>();
  for (const s of raw) if (known.has(s.entry_id) && !byId.has(s.entry_id)) byId.set(s.entry_id, s);
  return entries.map((e) => {
    const s = byId.get(e.id);
    if (!s) return { entry_id: e.id, action: "keep", reason: t("No suggestion") };
    if (s.action === "object" && !(s.target_item_id && targets.has(s.target_item_id)))
      return { entry_id: e.id, action: "keep", reason: t("Target not found") };
    if ((s.action === "note" || s.action === "task") && !s.title?.trim())
      return { ...s, title: e.text.split("\n")[0]!.slice(0, 80) };
    return s;
  });
}

export async function suggestCleanup(ctx: Ctx, models: ModelRouter) {
  const { item_id, entries } = await listEntries(ctx);
  if (!item_id || entries.length === 0) return { item_id, entries, suggestions: [] as Suggestion[] };
  const candidates = await loadObjectCandidates(ctx);
  const { output } = await generateText({
    model: modelFor(models, "auto_organize"),
    system: cleanupSystem(),
    prompt: [
      `${byLocale({ en: "Existing people/objects", de: "Vorhandene Personen/Objekte" })}:\n${candidates.map((c) => `- ${c.id} (${c.type}) ${c.title}`).join("\n") || byLocale({ en: "(none)", de: "(keine)" })}`,
      `<eintraege>\n${entries
        .map((e) => `[${e.id}] ${e.at}\n${e.text}`)
        .join("\n---\n")
        .slice(0, 60_000)}\n</eintraege>`,
    ].join("\n\n"),
    output: Output.object({ schema: CleanupOutputSchema, name: "scratchpad_cleanup" }),
    temperature: 0,
  });
  const suggestions = sanitizeSuggestions(output.suggestions, entries, new Set(candidates.map((c) => c.id)));
  return { item_id, entries, suggestions };
}

// --- apply ----------------------------------------------------------------------------------

export interface ApplyResult {
  entry_id: string;
  ok: boolean;
  error?: string;
  created_id?: string;
}

/**
 * Creates the target (reusing createNoteFor, action_items and the object's own body) and then, for
 * every entry that worked, removes it from the pad. Failed entries stay. Discard removes only the line.
 */
export async function applyDecisions(ctx: Ctx, decisions: readonly Decision[]) {
  const { item_id, entries } = await listEntries(ctx);
  if (!item_id) throw badRequest(t("The Scratchpad is empty"));
  const results: ApplyResult[] = [];
  const done = new Set<string>();
  for (const d of decisions) {
    const entry = entries.find((e) => e.id === d.entry_id);
    if (!entry) {
      results.push({ entry_id: d.entry_id, ok: false, error: t("Entry no longer exists") });
      continue;
    }
    try {
      let created: string | undefined;
      const firstLine = entry.text.split("\n")[0]!.slice(0, 80);
      if (d.action === "note") {
        created = await createNoteTarget(ctx, d.title?.trim() || firstLine, entry.text, item_id);
      } else if (d.action === "task") {
        await createTaskTarget(ctx, {
          title: (d.title?.trim() || firstLine).slice(0, 300),
          description: entry.text.includes("\n") ? entry.text : null,
          sourceItemId: item_id,
        });
      } else if (d.action === "object") {
        if (!d.target_item_id) throw new Error(t("Target is missing"));
        created = await appendToObjectTarget(ctx, d.target_item_id, entry.text);
      }
      done.add(entry.id);
      results.push({ entry_id: entry.id, ok: true, created_id: created });
    } catch (err) {
      results.push({ entry_id: d.entry_id, ok: false, error: err instanceof Error ? err.message : t("Error") });
    }
  }
  if (done.size) {
    // W-03: lines leave the pad only once the archive holds them; otherwise they stay and report the failure
    // (a retry is safe: targets go through dedup, the archive skips lines it already has).
    if (await archiveEntries(ctx, entries.filter((e) => done.has(e.id)))) {
      await swap(ctx, item_id, (m) => removeEntries(m, done));
    } else {
      for (const r of results) {
        if (!done.has(r.entry_id)) continue;
        r.ok = false;
        r.error = t("Archive not saved, the entry stays in the Scratchpad");
      }
    }
  }
  return { results, ...(await listEntries(ctx)) };
}
