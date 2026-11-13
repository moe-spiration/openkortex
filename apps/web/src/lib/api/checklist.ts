/*
 * Markdown checklists in a note body (`- [ ] Text` / `- [x] Text`) and their action items.
 * A body line and an action item of that note match by normalised text. Used by the notes store
 * (optimistic) and by the server actions (persisted), so both sides agree.
 */

import { parseTaskLine } from "@kortex/db/tasks";

export interface ChecklistLine {
  /** 0-based line number in the body. */
  line: number;
  text: string;
  done: boolean;
}

const LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*\S)\s*$/;

/** Matching key: trimmed, whitespace collapsed, lower case, trailing punctuation ignored. */
export const checklistKey = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!:;]+$/, "")
    .toLowerCase();

/**
 * Key of a body line's text: a rich task line (`Titel · Zeitrahmen: … <!-- task:id -->`, the
 * "## Aufgaben" section of @kortex/db task-section.ts) matches by its title only.
 */
const lineKey = (text: string): string => checklistKey(parseTaskLine(`- [ ] ${text}`)?.title ?? text);

export function parseChecklist(md: string): ChecklistLine[] {
  const out: ChecklistLine[] = [];
  md.split("\n").forEach((l, line) => {
    const m = LINE.exec(l);
    if (m) out.push({ line, text: m[4]!.trim(), done: m[2] !== " " });
  });
  return out;
}

/** Sets the first checklist line matching `text` to `done`; returns the body unchanged when none matches. */
export function setChecklistDone(md: string, text: string, done: boolean): string {
  const key = checklistKey(text);
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]!);
    if (m && lineKey(m[4]!) === key) {
      const next = `${m[1]}${done ? "x" : " "}${m[3]}${m[4]}`;
      if (next === lines[i]) return md;
      lines[i] = next;
      return lines.join("\n");
    }
  }
  return md;
}

/**
 * Action items whose done state differs from the matching body line (first match per text):
 * the changes a body edit implies for the task list.
 */
export function checklistChanges<T extends { id: string; text: string; done: boolean }>(
  md: string,
  items: readonly T[],
): { id: string; done: boolean }[] {
  const byKey = new Map<string, boolean>();
  for (const l of parseChecklist(md)) if (!byKey.has(lineKey(l.text))) byKey.set(lineKey(l.text), l.done);
  return items.flatMap((a) => {
    const done = byKey.get(checklistKey(a.text));
    return done !== undefined && done !== a.done ? [{ id: a.id, done }] : [];
  });
}
