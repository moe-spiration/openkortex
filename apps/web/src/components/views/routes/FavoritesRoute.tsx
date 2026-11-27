"use client";

import { useMemo } from "react";
import { SpaceView } from "@/components/views/SpaceView";
import { noteEntry, objectEntry } from "@/components/views/entries";
import type { MockObject } from "@/lib/mock/objects";
import { useSnapshot } from "@/lib/supabase/useSnapshot";
import { t, tn } from "@/i18n";

const starred = (i: object) => (i as { favorite?: boolean }).favorite === true;

/*
 * G4 (feedback round 3): Favoriten as its own category. Every note and object marked with the star
 * (knowledge_items.is_favorite, context menu "Als Favorit markieren") in the collection view of the Spaces.
 * Removing the star refreshes the list, so the entry leaves this view at once.
 */
export function FavoritesRoute() {
  const snap = useSnapshot();
  const entries = useMemo(
    () => [...snap.notes.filter(starred).map(noteEntry), ...snap.objects.filter(starred).map((o) => objectEntry(o as MockObject))],
    [snap],
  );
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
      emptyArt="idea"
      emptyText={t("Right-click an entry and choose “Mark as favorite”. It then shows up here.")}
      emptyActions={null}
    />
  );
}
