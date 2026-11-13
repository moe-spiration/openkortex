"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { showsDraftEditor, useActiveDraft } from "@/lib/notes/active-draft";
import { NEW_NOTE_HREF } from "@/lib/shell/new-note";
import { NewNoteEditor } from "./NewNoteEditor";

/**
 * /notes/* (layout): on /notes/new, and on /notes/<id> of the draft that editor just saved, the one NewNoteEditor
 * instance stays mounted in the same slot, so the address change after the first save (and Next re-rendering that
 * route after a server action) never swaps it for the note sheet or loses the caret. Every other note: the page.
 */
export function NotesRouteSwitch({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const draft = useActiveDraft();
  return showsDraftEditor(pathname, draft, NEW_NOTE_HREF) ? <NewNoteEditor /> : <>{children}</>;
}
