"use client";

import { useMemo } from "react";
import { notFound } from "next/navigation";
import { ObjectsView } from "@/components/views/ObjectsView";
import { objectTable } from "@/components/views/objectRows";
import { objectHref } from "@/lib/shell/routes";
import type { DomainKind } from "@/lib/data/collections";
import { useSnapshot } from "@/lib/supabase/useSnapshot";

/* Objekte (70_Objects/<Type>/): record table per type (Tactile Craft v2, dummy `Objects`), columns from the YAML frontmatter. */
export function ObjectHubRoute({ type, tag }: { type: string; tag?: string }) {
  const snap = useSnapshot();
  const hub = snap.objectHubs.find((h) => h.type === type);
  const view = useMemo(() => {
    if (!hub) return null;
    // objectTable reads the live views (NOTES, OBJECT_ITEMS), i.e. this snapshot.
    const table = objectTable(hub.type as DomainKind, tag ? (e) => e.tags.some((x) => x.label === tag) : undefined);
    const tabs = snap.objectHubs.map((h) => ({ type: h.type as DomainKind, label: h.label, count: snap.objects.filter((o) => o.type === h.type).length }));
    return { table, tabs };
  }, [hub, snap, tag]);
  if (!hub || !view) notFound();
  return (
    <ObjectsView
      key={hub.type}
      type={hub.type as DomainKind}
      tabs={view.tabs}
      table={view.table}
      total={snap.objects.length}
      folder={hub.folder}
      filter={tag ? { label: tag, clearHref: objectHref(hub.type) } : undefined}
    />
  );
}
