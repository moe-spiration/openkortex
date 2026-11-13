import { z } from "zod";
import { byLocale, getLocale } from "@kortex/i18n";
import { insertTaskOnce } from "@kortex/db";
import { t } from "@/i18n";
import { getItem, updateItem } from "../repo";
import { createNoteFor, updateNoteFor, type NoteCtx } from "../notes/service";
import { editNoteFor, ReplacementSchema, type EditData } from "./edit";
import type { Citation } from "./contract";
import type { ContextSource } from "./retrieval";
import { isDossierType, updateDossier } from "@/lib/dossier";

/*
 * Agent copilot: instead of one retrieval pass the chat model works in steps. It searches the vault
 * as often as it needs (`vault_search`), reads whole entries (`note_read`) and, depending on the
 * autonomy level, proposes or carries out changes:
 *   read  no write tools at all
 *   ask   write tools only record a proposal (`data-proposal`); nothing changes until the user
 *         confirms it (POST /api/chat/agent, op "execute")
 *   self  write tools run at once; every result carries what is needed to undo it (op "undo")
 * Changes stay inside the user's vault. Everything is scoped by user_id and RLS like the editor.
 */

export const AGENT_AUTONOMY = ["read", "ask", "self"] as const;
export type AgentAutonomy = (typeof AGENT_AUTONOMY)[number];

export const AGENT_SKILLS = ["briefing", "research", "tidy", "draft", "week", "dossier"] as const;
export type AgentSkill = (typeof AGENT_SKILLS)[number];

/** A change the agent wants to make. The same shape is proposed, confirmed and executed. */
export const AgentActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("note_create"),
    title: z.string().trim().min(1).max(300),
    markdown: z.string().max(60_000),
    folder_path: z.string().trim().min(1).max(300).optional(),
  }),
  z.object({
    kind: z.literal("note_edit"),
    item_id: z.uuid(),
    /** Title of the entry, for the confirmation card only. */
    item_title: z.string().max(300).optional(),
    replacements: z.array(ReplacementSchema).max(50).optional(),
    append_markdown: z.string().max(20_000).optional(),
    new_title: z.string().max(300).optional(),
  }),
  z.object({
    /** Living dossier of a person, company or project: only the two agent sections change. */
    kind: z.literal("dossier_update"),
    item_id: z.uuid(),
    item_title: z.string().max(300).optional(),
    /** New text of "Where things stand". */
    state: z.string().max(6_000).optional(),
    /** The complete new list of open points. */
    open_points: z.array(z.string().trim().min(1).max(400)).max(30).optional(),
  }),
  z.object({
    kind: z.literal("task_create"),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(2_000).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** The entry the task comes from. */
    source_item_id: z.uuid().optional(),
  }),
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

/** What the client needs to take a change back. */
export const AgentUndoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note_create"), item_id: z.uuid() }),
  z.object({
    kind: z.literal("note_edit"),
    item_id: z.uuid(),
    previous_md: z.string().max(2_000_000).optional(),
    previous_title: z.string().max(300).optional(),
  }),
  z.object({ kind: z.literal("task_create"), task_id: z.uuid() }),
]);
export type AgentUndo = z.infer<typeof AgentUndoSchema>;

export interface AgentActionResult {
  ok: boolean;
  /** One line for the UI: "Notiz „Briefing“ angelegt". */
  label: string;
  item_id?: string;
  error?: string;
  undo?: AgentUndo;
}

/** `data-step`: one visible step of the agent's work. */
export interface StepData {
  kind: "search" | "read" | "write";
  label: string;
  /** search: number of hits. */
  count?: number;
}
/** `data-proposal`: the changes waiting for the user's confirmation (autonomy "ask"). */
export interface ProposalData {
  actions: AgentAction[];
  /** One line per action, in the user's language. */
  labels: string[];
}
/** `data-done`: changes the agent already made (autonomy "self"). */
export interface DoneData {
  results: AgentActionResult[];
}

/** One line describing an action, in the user's language. */
export function actionLabel(a: AgentAction): string {
  if (a.kind === "note_create") return t("Create note “{title}”", { title: a.title });
  if (a.kind === "task_create") return t("Create task “{title}”", { title: a.title });
  if (a.kind === "dossier_update") return t("Update dossier “{title}”", { title: a.item_title ?? t("Entry") });
  const what = [
    a.replacements?.length ? t("replace text") : null,
    a.append_markdown?.trim() ? t("add text") : null,
    a.new_title?.trim() ? t("rename") : null,
  ].filter(Boolean);
  return t("Change “{title}”", { title: a.item_title ?? t("Entry") }) + (what.length ? ` (${what.join(", ")})` : "");
}

/**
 * The numbered sources of one answer. The first retrieval pass fills it; every `vault_search` adds
 * to it, so numbers stay stable while the model works and the answer can cite any of them.
 */
export class SourceRegistry {
  private readonly byKey = new Map<string, Citation>();
  constructor(
    initial: readonly Citation[] = [],
    private readonly snippetChars = 2_500,
  ) {
    for (const c of initial) this.byKey.set(`${c.item_id}|${c.page_or_timestamp ?? ""}`, c);
  }
  /** Adds sources; returns the citation of each (existing numbers are kept). */
  add(sources: readonly ContextSource[]): Citation[] {
    const out: Citation[] = [];
    for (const s of sources) {
      const key = `${s.item_id}|${s.page_or_timestamp ?? ""}`;
      let c = this.byKey.get(key);
      if (!c) {
        c = {
          n: this.byKey.size + 1,
          item_id: s.item_id,
          title: s.title,
          type: s.type,
          page_or_timestamp: s.page_or_timestamp,
          folder_path: s.folder_path,
          source_url: s.source_url,
          snippet: s.text.slice(0, this.snippetChars),
        };
        this.byKey.set(key, c);
      }
      if (!out.includes(c)) out.push(c);
    }
    return out;
  }
  get(n: number): Citation | undefined {
    for (const c of this.byKey.values()) if (c.n === n) return c;
    return undefined;
  }
  list(): Citation[] {
    return [...this.byKey.values()];
  }
}

/** Carries out one confirmed action. Never throws: a failure is reported in the result. */
export async function executeAction(
  ctx: NoteCtx,
  action: AgentAction,
  /** Called with the saved edit of a note_edit, so an open note can show it. */
  onEdit?: (edit: EditData) => void,
): Promise<AgentActionResult> {
  try {
    if (action.kind === "note_create") {
      const { id } = await createNoteFor(ctx, {
        title: action.title,
        contentMd: action.markdown,
        ...(action.folder_path ? { folderPath: action.folder_path } : {}),
      });
      return {
        ok: true,
        label: t("Note “{title}” created", { title: action.title }),
        item_id: id,
        undo: { kind: "note_create", item_id: id },
      };
    }
    if (action.kind === "task_create") {
      const res = await insertTaskOnce(ctx.client, ctx.userId, {
        user_id: ctx.userId,
        title: action.title,
        description: action.description ?? null,
        status: "open",
        due_date: action.due_date ?? null,
        source_item_id: action.source_item_id ?? null,
      });
      // An open task with the same title already exists: nothing new, so nothing to undo.
      if (res.duplicate) return { ok: true, label: t("Task “{title}” already exists", { title: action.title }) };
      return {
        ok: true,
        label: t("Task “{title}” created", { title: action.title }),
        undo: { kind: "task_create", task_id: res.id },
      };
    }
    if (action.kind === "dossier_update") {
      const item = await getItem(ctx.client, ctx.userId, action.item_id, ["id", "title", "type", "content_md"] as const);
      if (!item) return { ok: false, label: actionLabel(action), error: t("Entry not found") };
      if (!isDossierType(item.type))
        return { ok: false, label: actionLabel(action), item_id: item.id, error: t("Only persons, companies and projects have a dossier") };
      const previous = item.content_md ?? "";
      const next = updateDossier(previous, { state: action.state, open: action.open_points }, getLocale());
      if (next === previous) return { ok: false, label: actionLabel(action), item_id: item.id, error: t("No change given") };
      await updateNoteFor(ctx, item.id, { contentMd: next });
      onEdit?.({ item_id: item.id, title: item.title, content_md: next, replacements: [] });
      return {
        ok: true,
        label: t("Dossier “{title}” updated", { title: item.title }),
        item_id: item.id,
        undo: { kind: "note_edit", item_id: item.id, previous_md: previous },
      };
    }
    const before = await getItem(ctx.client, ctx.userId, action.item_id, ["id", "title", "content_md"] as const);
    if (!before) return { ok: false, label: actionLabel(action), error: t("Entry not found") };
    const { result, data } = await editNoteFor(ctx, action.item_id, {
      replacements: action.replacements,
      append_markdown: action.append_markdown,
      new_title: action.new_title,
    });
    if (!result.ok || !data) return { ok: false, label: actionLabel(action), item_id: action.item_id, error: result.error };
    onEdit?.(data);
    return {
      ok: true,
      label: t("“{title}” changed", { title: data.title }),
      item_id: action.item_id,
      undo: {
        kind: "note_edit",
        item_id: action.item_id,
        ...(data.content_md !== undefined ? { previous_md: before.content_md ?? "" } : {}),
        ...(data.previous_title ? { previous_title: data.previous_title } : {}),
      },
    };
  } catch (err) {
    return { ok: false, label: actionLabel(action), error: err instanceof Error ? err.message : String(err) };
  }
}

/** Takes one change back. A created note is archived (never deleted), a created task removed. */
export async function undoAction(ctx: NoteCtx, undo: AgentUndo): Promise<{ ok: boolean; error?: string }> {
  try {
    if (undo.kind === "note_create") {
      const item = await getItem(ctx.client, ctx.userId, undo.item_id, ["id"] as const);
      if (!item) return { ok: false, error: t("Entry not found") };
      await updateItem(ctx.client, ctx.userId, undo.item_id, { status: "archived" });
      return { ok: true };
    }
    if (undo.kind === "task_create") {
      const { error } = await ctx.client.from("action_items").delete().eq("user_id", ctx.userId).eq("id", undo.task_id);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }
    await updateNoteFor(ctx, undo.item_id, {
      ...(undo.previous_md !== undefined ? { contentMd: undo.previous_md } : {}),
      ...(undo.previous_title ? { title: undo.previous_title } : {}),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const SKILL_PROMPTS: Record<AgentSkill, { en: string; de: string }> = {
  briefing: {
    en: "Skill briefing: prepare the user for a conversation. Find the person, company or project in the vault, read the dossier and the latest meetings, then write a short briefing: where things stand, open points, decisions made, what to ask. Offer to save it as a note in 20_Meetings.",
    de: "Fähigkeit Briefing: Bereite den Nutzer auf ein Gespräch vor. Finde Person, Firma oder Projekt im Vault, lies die Akte und die letzten Meetings und schreibe ein kurzes Briefing: Stand der Dinge, offene Punkte, getroffene Entscheidungen, was zu fragen ist. Biete an, es als Notiz in 20_Meetings zu speichern.",
  },
  research: {
    en: "Skill research: search the vault from several angles (at least three different searches), compare what you find and write a short report with the key findings and what is still unknown. Offer to save the report as a note.",
    de: "Fähigkeit Recherche: Durchsuche den Vault aus mehreren Blickwinkeln (mindestens drei verschiedene Suchen), vergleiche die Funde und schreibe einen kurzen Bericht mit den wichtigsten Erkenntnissen und dem, was noch offen ist. Biete an, den Bericht als Notiz zu speichern.",
  },
  tidy: {
    en: "Skill tidy up: look at the newest entries in 00_Inbox, say for each where it belongs and which ones look like duplicates. Propose the changes; do not move anything yourself.",
    de: "Fähigkeit Aufräumen: Sieh dir die neuesten Einträge in 00_Inbox an, sag zu jedem, wohin er gehört und welche nach Duplikaten aussehen. Schlage die Änderungen vor; verschiebe nichts selbst.",
  },
  draft: {
    en: "Skill draft: write the mail or text the user asks for, in the user's own tone, using what the vault knows about the recipient and the matter. Show the draft in the answer and offer to save it as a note.",
    de: "Fähigkeit Entwurf: Schreibe die Mail oder den Text, den der Nutzer verlangt, in seinem eigenen Ton, mit dem Wissen des Vaults über Empfänger und Sache. Zeige den Entwurf in der Antwort und biete an, ihn als Notiz zu speichern.",
  },
  week: {
    en: "Skill weekly review: read this week's daily notes and new entries, name the themes, what went well, what cost energy and the open loops. Offer to save the review as a note in 90_Digests and to create tasks for the open loops.",
    de: "Fähigkeit Wochenrückblick: Lies die Tagesnotizen und neuen Einträge dieser Woche, benenne die Themen, was gut lief, was Energie gekostet hat und die offenen Schleifen. Biete an, den Rückblick als Notiz in 90_Digests zu speichern und Aufgaben für die offenen Schleifen anzulegen.",
  },
  dossier: {
    en: "Skill dossier: bring the dossier of a person, company or project up to date. Read the existing entry with note_read, then search for everything newer that mentions it (meetings, notes, clippings). Then call dossier_update once: state = where things stand now in three to five sentences (what was decided, what is open, whose move it is), open_points = the complete list of points still open (keep the ones that still hold, drop what is settled, add new ones). Never use note_edit on a dossier and never touch the user's own notes. Afterwards say in two or three sentences what changed.",
    de: "Fähigkeit Akte pflegen: Bring die Akte einer Person, Firma oder eines Projekts auf Stand. Lies den bestehenden Eintrag mit note_read und suche dann alles Neuere, das ihn erwähnt (Meetings, Notizen, Clippings). Rufe danach einmal dossier_update auf: state = der Stand der Dinge in drei bis fünf Sätzen (was entschieden ist, was offen ist, wer am Zug ist), open_points = die vollständige Liste der noch offenen Punkte (behalte, was weiter gilt, streiche Erledigtes, ergänze Neues). Nutze bei einer Akte nie note_edit und fass die eigenen Notizen des Nutzers nie an. Sag danach in zwei bis drei Sätzen, was sich geändert hat.",
  },
};

/** The agent part of the system prompt (appended to the copilot prompt). */
export function agentPrompt(autonomy: AgentAutonomy, skill: AgentSkill | undefined, noteOpen: boolean): string {
  const writes = byLocale({
    en: {
      read: "You cannot change anything (read only). If a change would help, say what you would do.",
      ask: "Changes (note_create, note_edit, dossier_update, task_create) are only proposed: the user sees them as a list and confirms them. Call the tools for everything you suggest, then tell the user briefly what is waiting for confirmation. Never claim something was saved.",
      self: "Changes (note_create, note_edit, dossier_update, task_create) are carried out at once and can be undone by the user. Make only the changes the request needs and report each one briefly.",
    },
    de: {
      read: "Du kannst nichts ändern (nur lesen). Wenn eine Änderung helfen würde, sag, was du tun würdest.",
      ask: "Änderungen (note_create, note_edit, dossier_update, task_create) werden nur vorgeschlagen: Der Nutzer sieht sie als Liste und bestätigt sie. Rufe die Werkzeuge für alles auf, was du vorschlägst, und sag dem Nutzer dann kurz, was auf Bestätigung wartet. Behaupte nie, etwas sei gespeichert.",
      self: "Änderungen (note_create, note_edit, dossier_update, task_create) werden sofort ausgeführt und sind für den Nutzer rückgängig zu machen. Mach nur die Änderungen, die der Auftrag braucht, und berichte jede kurz.",
    },
  })[autonomy];
  const skillLine = skill ? `\n${byLocale(SKILL_PROMPTS[skill])}` : "";
  return byLocale({
    en: `
You work as an agent, in steps:
- The sources above are only a first pass. Use vault_search whenever something is missing, with different wording and narrower questions, until you can really answer. New hits get new numbers [n] you can cite.
- Use note_read to read an entry in full before you rely on details or change it${noteOpen ? " (omit source for the open note)" : ""}.
- Do the work instead of describing it: if the user asks for a briefing, a draft or a summary, write it.
- ${writes}${skillLine}
`,
    de: `
Du arbeitest als Agent, in Schritten:
- Die Quellen oben sind nur ein erster Durchgang. Nutze vault_search, sobald etwas fehlt, mit anderen Formulierungen und engeren Fragen, bis du wirklich antworten kannst. Neue Treffer bekommen neue Nummern [n], die du zitieren kannst.
- Lies einen Eintrag mit note_read ganz, bevor du dich auf Details verlässt oder ihn änderst${noteOpen ? " (source weglassen für die geöffnete Notiz)" : ""}.
- Erledige die Arbeit, statt sie zu beschreiben: Wenn der Nutzer ein Briefing, einen Entwurf oder eine Zusammenfassung will, schreib es.
- ${writes}${skillLine}
`,
  });
}

/** POST /api/chat/agent: confirm proposed actions or take changes back. */
export const AgentRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("execute"), actions: z.array(AgentActionSchema).min(1).max(20) }),
  z.object({ op: z.literal("undo"), undo: z.array(AgentUndoSchema).min(1).max(20) }),
]);
export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type AgentResponse =
  | { ok: true; op: "execute"; results: AgentActionResult[]; edits: EditData[] }
  | { ok: true; op: "undo"; results: { ok: boolean; error?: string }[] };
