import { z } from "zod";
import { byLocale, getLocale, type Locale } from "@kortex/i18n";
import { t } from "@/i18n";
import { getItem } from "../repo";
import { updateNoteFor, type NoteCtx } from "../notes/service";
import { applyReplacements, type ReplacementResult } from "@/lib/text/replace";

/*
 * Copilot edits on existing entries (Orbit-Bar "Fragen", copilot drawer, desktop launcher, mobile
 * chat): the chat model gets two tools, `note_read` and `note_edit`, when the user asks for a
 * change ("Ersetze im Transkript Mayer durch Meier"). Edits are exact search-and-replace on the
 * stored Markdown plus an optional appended section and a new title, so a long transcript is never
 * rewritten by the model and nothing outside the named strings changes. Saves go through
 * updateNoteFor (content hash, checklist → task sync), the same path as the editor.
 */

export { applyReplacements, type ReplacementResult } from "@/lib/text/replace";

/* The field descriptions are part of the prompt (the model reads them), so the schema exists once per language. */
const buildSchemas = (locale: Locale) => {
  const d = (en: string, de: string) => byLocale({ en, de }, locale);
  /** One replacement: every occurrence of `find` becomes `replace`. */
  const replacement = z.object({
    find: z.string().min(1).max(5_000).describe(d("Exact text as it appears in the note", "Exakter Text, wie er in der Notiz steht")),
    replace: z.string().max(20_000).describe(d("New text (empty = delete)", "Neuer Text (leer = löschen)")),
    whole_word: z
      .boolean()
      .optional()
      .describe(
        d(
          "Replace whole words only (default true, e.g. for names); false for parts of sentences",
          "Nur ganze Wörter ersetzen (Standard true, z. B. für Namen); false für Satzteile",
        ),
      ),
    case_sensitive: z.boolean().optional().describe(d("Match case (default true)", "Groß-/Kleinschreibung beachten (Standard true)")),
  });
  const noteEdit = z.object({
    source: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        d(
          "Number [n] of the source to change; omit = the open note",
          "Nummer [n] der Quelle, die geändert wird; weglassen = die geöffnete Notiz",
        ),
      ),
    replacements: z.array(replacement).max(50).optional(),
    append_markdown: z
      .string()
      .max(20_000)
      .optional()
      .describe(d("Markdown appended at the end of the note", "Markdown, das am Ende der Notiz angefügt wird")),
    new_title: z
      .string()
      .max(300)
      .optional()
      .describe(d("New title, only when explicitly asked for", "Neuer Titel, nur wenn ausdrücklich gewünscht")),
  });
  return { replacement, noteEdit };
};
const SCHEMAS = { en: buildSchemas("en"), de: buildSchemas("de") };

/** One replacement: every occurrence of `find` becomes `replace`. */
export const ReplacementSchema = SCHEMAS.en.replacement;
/** Validation shape (English descriptions); as a tool schema use `noteEditInputSchema()`. */
export const NoteEditInputSchema = SCHEMAS.en.noteEdit;
/** The `note_edit` tool schema with descriptions in the current language. */
export const noteEditInputSchema = (): typeof NoteEditInputSchema => SCHEMAS[getLocale()].noteEdit;
export type NoteEditInput = z.infer<typeof NoteEditInputSchema>;

/** Sent to the web client as a `data-edit` part, so an open note shows the change and can undo it. */
export interface EditData {
  item_id: string;
  title: string;
  /** Body after the edit (absent when only the title changed). */
  content_md?: string;
  replacements: (ReplacementResult & { whole_word?: boolean; case_sensitive?: boolean })[];
  /** Markdown appended at the end, if any. */
  appended_md?: string;
  /** Title before a rename (for undo). */
  previous_title?: string;
}

export interface NoteEditResult {
  ok: boolean;
  item_id?: string;
  title?: string;
  replacements?: ReplacementResult[];
  appended?: boolean;
  renamed?: boolean;
  error?: string;
}

const READ_LIMIT = 60_000;

/** The full Markdown of an entry for `note_read` (cut at READ_LIMIT characters). */
export async function readNoteFor(
  ctx: NoteCtx,
  itemId: string,
): Promise<{ ok: boolean; title?: string; content_md?: string; truncated?: boolean; error?: string }> {
  const item = await getItem(ctx.client, ctx.userId, itemId, ["id", "title", "content_md"]);
  if (!item) return { ok: false, error: t("Entry not found") };
  const md = item.content_md ?? "";
  return {
    ok: true,
    title: item.title,
    content_md: md.slice(0, READ_LIMIT),
    truncated: md.length > READ_LIMIT,
  };
}

/**
 * Applies a `note_edit` call to the user's entry and saves it. Nothing is saved when no
 * replacement matched and nothing else changes (the model then reads the note and retries).
 */
export async function editNoteFor(
  ctx: NoteCtx,
  itemId: string,
  input: Omit<NoteEditInput, "source">,
): Promise<{ result: NoteEditResult; data: EditData | null }> {
  const item = await getItem(ctx.client, ctx.userId, itemId, ["id", "title", "content_md"]);
  if (!item) return { result: { ok: false, error: t("Entry not found") }, data: null };
  const before = item.content_md ?? "";
  const { content, results } = applyReplacements(before, input.replacements ?? []);
  const append = input.append_markdown?.trim();
  const next = append ? `${content.replace(/\s+$/, "")}\n\n${append}\n` : content;
  const title = input.new_title?.trim();
  const renamed = !!title && title !== item.title;
  const changed = next !== before;
  if (!changed && !renamed) {
    return {
      result: {
        ok: false,
        item_id: item.id,
        title: item.title,
        replacements: results,
        error:
          results.length > 0
            ? t("No match: text not found. Read the note with note_read and use the exact spelling.")
            : t("No change given"),
      },
      data: null,
    };
  }
  await updateNoteFor(ctx, item.id, {
    ...(changed ? { contentMd: next } : {}),
    ...(renamed ? { title } : {}),
  });
  const finalTitle = renamed ? title : item.title;
  return {
    result: {
      ok: true,
      item_id: item.id,
      title: finalTitle,
      replacements: results,
      appended: !!append,
      renamed,
    },
    data: {
      item_id: item.id,
      title: finalTitle,
      ...(changed ? { content_md: next } : {}),
      replacements: results.map((r, i) => ({
        ...r,
        whole_word: input.replacements?.[i]?.whole_word,
        case_sensitive: input.replacements?.[i]?.case_sensitive,
      })),
      ...(append ? { appended_md: append } : {}),
      ...(renamed ? { previous_title: item.title } : {}),
    },
  };
}

/**
 * Does the conversation ask for a change to an entry? Only then the chat model gets the edit tools
 * (cheaper prompts, and a plain question can never edit a note). Looks at the last two user turns,
 * so "ja, mach das" after a proposal still works.
 */
const EDIT_INTENT =
  /(ersetz|korrigier|berichtig|richtigstell|änder|aender|bearbeit|umbenenn|benenn\w*\s+um|austausch|tausch|ergänz|erganz|hinzufüg|füg\w*\s.*\shinzu|streich|entfern|lösch|losch|schreib\w*\s.*\sum\b|umschreib|überarbeit|trag\w*\s.*\sein\b|replace|rename|correct|\bfix\b|\bedit\b|\bchange\b|\bupdate\b|\bremove\b|\bdelete\b|mach das|mach es|ja,? bitte|^\s*ja\b|^\s*ok\b)/i;

export function wantsEdit(userTurns: readonly string[]): boolean {
  return userTurns.slice(-2).some((t) => EDIT_INTENT.test(t));
}

export function editToolsPrompt(noteOpen: boolean): string {
  return byLocale({
    en: `
Changing existing entries (tools note_read and note_edit):
- Use them only when the user explicitly asks for a change (correct, replace, add, rename, delete text). For plain questions change nothing.
- Target: ${noteOpen ? "by default the open note (omit source); another source by its number [n]." : "the matching source by its number [n]. If it is unclear which entry is meant, ask instead of guessing."}
- Correcting names or terms: note_edit with replacements (find = exactly the wrong text, replace = the right one). All occurrences are replaced. Think of variants (e.g. the possessive "Mayer's", other spellings) the user means.
- Longer rewording: first note_read, then the exact paragraph as find (whole_word false) and the new text as replace.
- If note_edit reports "No match", read the note with note_read and try again with the exact spelling.
- Then report briefly: which entry, what was replaced and how often. No source references [n] needed for this report.
`,
    de: `
Bestehende Einträge ändern (Werkzeuge note_read und note_edit):
- Nutze sie nur, wenn der Nutzer ausdrücklich eine Änderung verlangt (korrigieren, ersetzen, ergänzen, umbenennen, löschen von Text). Bei bloßen Fragen nichts ändern.
- Ziel: ${noteOpen ? "standardmäßig die geöffnete Notiz (source weglassen); eine andere Quelle über ihre Nummer [n]." : "die passende Quelle über ihre Nummer [n]. Ist unklar, welcher Eintrag gemeint ist, frag nach statt zu raten."}
- Namen oder Begriffe korrigieren: note_edit mit replacements (find = exakt der falsche Text, replace = der richtige). Alle Vorkommen werden ersetzt. Denk an Varianten (z. B. Genitiv "Mayers", andere Schreibweisen), die der Nutzer meint.
- Längere Umformulierungen: erst note_read, dann den exakten Absatz als find (whole_word false) und den neuen Text als replace.
- Meldet note_edit "Kein Treffer", lies die Notiz mit note_read und versuche es mit der exakten Schreibweise erneut.
- Danach kurz berichten: welcher Eintrag, was ersetzt wurde und wie oft. Keine Quellenbelege [n] nötig für diesen Bericht.
`,
  });
}
