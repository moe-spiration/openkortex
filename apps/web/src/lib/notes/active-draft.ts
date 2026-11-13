"use client";

import { useSyncExternalStore } from "react";

/*
 * The note the new-note editor is writing right now (W4 check of /notes/new). After the first save the editor moves
 * the address to /notes/<id> in place; the next server action (body, title, icon, cover) makes Next re-render that
 * route, which used to swap the editor for the note sheet mid-typing. The /notes layout reads this id and keeps the
 * editor mounted for it. Set by NewNoteEditor on create, cleared when it starts a new draft or unmounts.
 */

let active: string | null = null;
const listeners = new Set<() => void>();

export function setActiveDraft(id: string | null): void {
  if (active === id) return;
  active = id;
  for (const l of listeners) l();
}

export const activeDraft = (): string | null => active;

export function useActiveDraft(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
    () => null,
  );
}

/** Should the /notes layout show the new-note editor for this address? */
export function showsDraftEditor(pathname: string, draftId: string | null, newHref = "/notes/new"): boolean {
  return pathname === newHref || (!!draftId && pathname === `/notes/${draftId}`);
}
