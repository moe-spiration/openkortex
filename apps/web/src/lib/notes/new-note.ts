import { t, tx } from "@/i18n";
import type { Tab } from "@/lib/shell/prefs";
import { NEW_NOTE_TAB_KEY } from "@/lib/shell/routes";
import { NEW_NOTE_PICK_TEMPLATE, type NewNotePrefill } from "@/lib/shell/new-note";

/*
 * New-note editor (/notes/new, Tactile Craft v2 decision 8): templates, the vault path shown in the footer and the
 * hand-over of the "Ohne Titel" tab to the saved note. Pure helpers, tested in new-note.test.ts.
 */

/** Folder new notes go to (shown as "automatisch, änderbar"). */
export const NEW_NOTE_FOLDER = "10_Notes";

export type TemplateId = "blank" | "meeting" | "daily" | "brief" | "reading";

export interface NoteTemplate {
  id: TemplateId;
  label: string;
  /** Lucide icon name (components/note/icons.tsx). */
  icon: "file" | "mic" | "sun" | "folder-kanban" | "book-open";
  /** Markdown the body starts with. */
  body: string;
  /**
   * W-18: the template opens a note that already exists instead of filling this draft. "Tagesnotiz" is the
   * day's daily note (10_Notes/Daily, the same file as the Home check-in and the Journal), never a second note.
   */
  opens?: "daily-note";
}

/** Labels and bodies are getters: a template is written in the language of the moment it is used. */
export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: "blank",
    get label() {
      return t("Blank note");
    },
    icon: "file",
    body: "",
  },
  {
    id: "meeting",
    get label() {
      return t("Meeting note");
    },
    icon: "mic",
    get body() {
      return `**${t("Participants:")}** \n\n## ${t("Agenda")}\n\n- \n\n## ${t("Decisions")}\n\n- \n\n## ${tx("heading", "Tasks")}\n\n- [ ] \n`;
    },
  },
  {
    id: "daily",
    get label() {
      return tx("template", "Daily note (today)");
    },
    icon: "sun",
    body: "",
    opens: "daily-note",
  },
  {
    id: "brief",
    get label() {
      return t("Project brief");
    },
    icon: "folder-kanban",
    get body() {
      return `## ${t("Goal")}\n\n## ${t("Why now")}\n\n## ${t("Success means")}\n\n## ${t("Risks")}\n`;
    },
  },
  {
    id: "reading",
    get label() {
      return t("Reading note");
    },
    icon: "book-open",
    get body() {
      return `**${t("Source:")}** \n\n## ${t("Key message")}\n\n## ${t("Quotes")}\n\n> \n`;
    },
  },
];

export const templateById = (id: TemplateId): NoteTemplate => NOTE_TEMPLATES.find((tpl) => tpl.id === id) ?? NOTE_TEMPLATES[0]!;

/** File name the vault will use, as shown in the footer (lower case, dashes; "ohne-titel" while empty). */
export function noteSlug(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || tx("slug", "untitled");
}

export const newNotePath = (title: string, folder = NEW_NOTE_FOLDER) => `${folder}/${noteSlug(title)}.md`;

export const isTemplateId = (id: unknown): id is TemplateId => NOTE_TEMPLATES.some((t) => t.id === id);

export interface InitialDraft {
  title: string;
  body: string;
  /** Template preselected by the prefill; its Markdown already stands in front of the body. */
  template?: TemplateId;
  /** "Aus Vorlage …": the editor opens with the template menu open. */
  pickTemplate?: true;
}

/** Initial editor state from the one-time prefill (takeNewNotePrefill), including a preselected template. */
export function initialDraft(prefill: NewNotePrefill | null): InitialDraft {
  const title = prefill?.title ?? "";
  const body = prefill?.body ?? "";
  const tpl = prefill?.template;
  if (isTemplateId(tpl)) return { title, body: applyTemplate(body, templateById(tpl)), template: tpl };
  if (tpl === NEW_NOTE_PICK_TEMPLATE) return { title, body, pickTemplate: true };
  return { title, body };
}

/** A draft is saved as soon as it has a title or text; a lone slash command being typed does not count. */
export const hasContent = (d: { title: string; body: string }) => !!(d.title.trim() || d.body.replace(/^\s*\/\S*\s*$/, "").trim());

/** Body with a template in front of what was already typed (templates never drop text). */
export function applyTemplate(body: string, tpl: NoteTemplate): string {
  const head = tpl.body;
  if (!head) return body;
  return body.trim() ? `${head.trimEnd()}\n\n${body}` : head;
}

/**
 * The "Ohne Titel" tab becomes the saved note's tab in place (same position): key note:<id>, the title as label
 * and /notes/<id> as target. Without a new-note tab the note's tab is appended (or kept when it exists).
 */
export function promoteNewNoteTab(tabs: Tab[], note: { id: string; title: string; href: string; icon: Tab["icon"] }): Tab[] {
  const key = `note:${note.id}`;
  const tab: Tab = { key, label: note.title.trim() || t("Untitled"), icon: note.icon, href: note.href };
  const without = tabs.filter((t) => t.key !== key);
  const i = without.findIndex((t) => t.key === NEW_NOTE_TAB_KEY);
  if (i >= 0) return without.map((t, j) => (j === i ? tab : t));
  return tabs.some((t) => t.key === key) ? tabs : [...tabs, tab];
}

/** Keeps the note's tab label in step with the title while typing. */
export function renameNoteTab(tabs: Tab[], id: string, title: string): Tab[] {
  const key = `note:${id}`;
  const label = title.trim() || t("Untitled");
  const i = tabs.findIndex((t) => t.key === key);
  if (i < 0 || tabs[i]!.label === label) return tabs;
  return tabs.map((t, j) => (j === i ? { ...t, label } : t));
}
