import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("New note") };
}

/*
 * New-note editor route (Tactile Craft v2, decision 8). Every "new note" entry point lands here through the shell
 * store's openNewNote(prefill?) (lib/shell/store.tsx); the editor reads the prefill exactly once with
 * takeNewNotePrefill() (lib/shell/new-note.ts). Package C: components/note/NewNoteEditor.tsx.
 * The editor itself is rendered by the /notes layout (NotesRouteSwitch), so it survives the move to /notes/<id>.
 */
export default function NewNotePage() {
  return null;
}
