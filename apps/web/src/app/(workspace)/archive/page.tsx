import { SpaceView } from "@/components/views/SpaceView";
import { noteEntry, objectEntry, type ViewEntry } from "@/components/views/entries";
import type { MockObject } from "@/lib/mock/objects";
import { timeZone } from "@/lib/supabase/config";
import { getSession } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/supabase/workspace";
import { loadArchivedItems } from "@/server/notes/archive";
import { t, tn } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("Archive") };
}
// Archived items change with every archive / restore: always load fresh.
export const dynamic = "force-dynamic";

/*
 * G4 (feedback round 3): Archiv as its own category. Archived items (status `archived`) are hidden everywhere
 * else; here they can be brought back ("Zurückholen") or deleted for good (with the usual undo window).
 * Mock mode has no archive (empty state).
 */
export default async function ArchivePage() {
  enterRequestLocale(await requestLocale());
  const snap = await loadWorkspace();
  let entries: ViewEntry[] = [];
  if (snap) {
    const session = await getSession();
    if (session) {
      const { notes, objects } = await loadArchivedItems(session.client, session.user.id, timeZone());
      entries = [...notes.map(noteEntry), ...objects.map((o) => objectEntry(o as MockObject))];
    }
  }
  return (
    <SpaceView
      scope="archive"
      densityScope="archive"
      crumbs={[{ label: t("Archive") }]}
      title={t("Archive")}
      help={tn(entries.length, "{n} archived entry", "{n} archived entries")}
      entries={entries}
      resetHref="/archive"
      week={false}
      archived
      emptyTitle={t("The archive is empty")}
      emptyText={t("Archived entries end up here. You can restore them or delete them for good.")}
      emptyActions={null}
    />
  );
}
