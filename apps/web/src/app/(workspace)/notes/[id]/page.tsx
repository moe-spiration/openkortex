import { NoteSheet } from "@/components/note/NoteSheet";
import { ALL_ITEMS } from "@/lib/workspace-data";
import { itemTitle } from "@/lib/supabase/item-title";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export function generateStaticParams() {
  return ALL_ITEMS.map((n) => ({ id: n.id }));
}

/* Only the title is read on the server (one row, lib/supabase/item-title.ts); the sheet renders from the client store. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  enterRequestLocale(await requestLocale());
  const { id } = await params;
  return { title: (await itemTitle(id)) ?? t("Note") };
}

/* Full-tab note: the same sheet as the drawer, filling the main window (prototype view "note"). */
export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div style={{ height: "100%" }}>
      <NoteSheet id={id} mode="full" />
    </div>
  );
}
