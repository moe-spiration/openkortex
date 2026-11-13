import { HashtagsView } from "@/components/views/HashtagsView";
import type { EntryObject } from "@/components/views/entries";
import { MOCK_TODAY, NOTES, OBJECT_ITEMS } from "@/lib/workspace-data";
import { linkIndex, monogram, tagIndex } from "@/lib/data/collections";
import { loadWorkspace } from "@/lib/supabase/workspace";

export const metadata = { title: "Hashtags" };

/* Hashtags (Tactile Craft v2, dummy `Hashtags`): hierarchical index with counts, share and 30-day sparkline from real timestamps. */
export default async function HashtagsPage() {
  await loadWorkspace();
  const { objectsOf } = linkIndex(NOTES, OBJECT_ITEMS);
  const groups = tagIndex(NOTES, OBJECT_ITEMS, objectsOf, MOCK_TODAY);
  const objects: Record<string, EntryObject> = Object.fromEntries(
    OBJECT_ITEMS.map((o) => [o.id, { id: o.id, title: o.title, kind: o.type as EntryObject["kind"], mono: monogram(o.title) }]),
  );
  return <HashtagsView groups={groups} objects={objects} entryCount={NOTES.filter((n) => n.tags.length > 0).length} />;
}
