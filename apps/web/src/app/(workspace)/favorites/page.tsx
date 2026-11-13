import { SpaceView } from "@/components/views/SpaceView";
import { noteEntry, objectEntry } from "@/components/views/entries";
import { NOTES, OBJECT_ITEMS } from "@/lib/workspace-data";
import { loadWorkspace } from "@/lib/supabase/workspace";
import { t, tn } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("Favorites") };
}

const starred = (i: object) => (i as { favorite?: boolean }).favorite === true;

/*
 * G4 (feedback round 3): Favoriten as its own category. Every note and object marked with the star
 * (knowledge_items.is_favorite, context menu "Als Favorit markieren") in the collection view of the Spaces.
 * Removing the star refreshes the list, so the entry leaves this view at once.
 */
export default async function FavoritesPage() {
  enterRequestLocale(await requestLocale());
  await loadWorkspace();
  const entries = [...NOTES.filter(starred).map(noteEntry), ...OBJECT_ITEMS.filter(starred).map(objectEntry)];
  return (
    <SpaceView
      scope="favorites"
      densityScope="favorites"
      crumbs={[{ label: t("Favorites") }]}
      title={t("Favorites")}
      help={tn(entries.length, "{n} starred entry", "{n} starred entries")}
      entries={entries}
      resetHref="/favorites"
      week={false}
      emptyTitle={t("No favorites yet")}
      emptyText={t("Right-click an entry and choose “Mark as favorite”. It then shows up here.")}
      emptyActions={null}
    />
  );
}
