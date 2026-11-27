"use client";

import { useMemo } from "react";
import { notFound } from "next/navigation";
import { SpaceView } from "@/components/views/SpaceView";
import { noteEntry } from "@/components/views/entries";
import { findSpace, spaceItems } from "@/lib/spaces";
import { spaceHref } from "@/lib/shell/routes";
import { collectionScope } from "@/lib/data/collections";
import { pillClass } from "@/lib/workspace-data";
import { useSnapshot } from "@/lib/supabase/useSnapshot";
import { t, tn } from "@/i18n";

/* Auto-Space (Tactile Craft v2, dummy `Spaces`): compact head, filter bar, Smart Mixes, week calendar, Grid | Liste | Timeline. */
export function SpaceRoute({ space, tag }: { space: string; tag?: string }) {
  const snap = useSnapshot();
  const { def, entries } = useMemo(() => {
    const def = findSpace(snap.autoSpaces, space);
    if (!def) return { def, entries: [] };
    let list = spaceItems(def, snap.notes);
    if (tag) {
      // A hashtag also matches its children (#ai matches #ai/mcp), case-insensitive: the Hashtags index links groups this way.
      const wanted = tag.toLowerCase();
      list = list.filter((n) => n.tags.some((x) => x.toLowerCase() === wanted || x.toLowerCase().startsWith(wanted + "/")));
    }
    return { def, entries: list.map(noteEntry) };
  }, [snap, space, tag]);
  if (!def) notFound();
  const help = !tag ? t("Showing {shown} of {total}", { shown: entries.length, total: def.count }) : tn(entries.length, "{n} entry", "{n} entries");
  return (
    <SpaceView
      key={def.key}
      scope={`space:${def.key}`}
      densityScope={collectionScope("spaces", def.key)}
      crumbs={[{ label: t("Library") }, { label: t("Types") }]}
      title={def.label}
      help={help}
      entries={entries}
      filters={tag ? [{ label: tag, cls: pillClass(tag), clearHref: spaceHref(def.key) }] : []}
      resetHref={spaceHref("all")}
      mixes={def.key === "all" && !tag}
      {...(def.key === "session" && !tag && entries.length === 0
        ? {
            emptyTitle: t("No sessions yet"),
            emptyText: t("Sessions come from the web clipper: choose “Save session” in the side panel, then all open tabs end up here and can be reopened with one click."),
            emptyActions: null,
          }
        : {})}
    />
  );
}
