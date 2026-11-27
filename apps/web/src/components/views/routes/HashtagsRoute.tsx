"use client";

import { useMemo } from "react";
import { HashtagsView } from "@/components/views/HashtagsView";
import type { EntryObject } from "@/components/views/entries";
import { linkIndex, monogram, tagIndex } from "@/lib/data/collections";
import { useSnapshot } from "@/lib/supabase/useSnapshot";

/* Hashtags (Tactile Craft v2, dummy `Hashtags`): hierarchical index with counts, share and 30-day sparkline from real timestamps. */
export function HashtagsRoute() {
  const snap = useSnapshot();
  const { groups, objects, entryCount } = useMemo(() => {
    const { objectsOf } = linkIndex(snap.notes, snap.objects);
    const objects: Record<string, EntryObject> = Object.fromEntries(
      snap.objects.map((o) => [o.id, { id: o.id, title: o.title, kind: o.type as EntryObject["kind"], mono: monogram(o.title) }]),
    );
    return {
      groups: tagIndex(snap.notes, snap.objects, objectsOf, snap.today),
      objects,
      entryCount: snap.notes.filter((n) => n.tags.length > 0).length,
    };
  }, [snap]);
  return <HashtagsView groups={groups} objects={objects} entryCount={entryCount} />;
}
