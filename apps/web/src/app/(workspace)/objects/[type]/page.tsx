import { notFound } from "next/navigation";
import { ObjectsView } from "@/components/views/ObjectsView";
import { objectTable } from "@/components/views/objectRows";
import { OBJECT_HUBS, OBJECT_ITEMS } from "@/lib/workspace-data";
import { objectHref } from "@/lib/shell/routes";
import { loadWorkspace } from "@/lib/supabase/workspace";
import type { DomainKind } from "@/lib/data/collections";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export function generateStaticParams() {
  return OBJECT_HUBS.map((h) => ({ type: h.type }));
}

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  enterRequestLocale(await requestLocale());
  await loadWorkspace();
  const { type } = await params;
  return { title: OBJECT_HUBS.find((h) => h.type === type)?.label ?? t("Objects") };
}

/* Objekte (70_Objects/<Type>/): record table per type (Tactile Craft v2, dummy `Objects`), columns from the YAML frontmatter. */
export default async function ObjectHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  enterRequestLocale(await requestLocale());
  await loadWorkspace();
  const [{ type }, { tag }] = await Promise.all([params, searchParams]);
  const hub = OBJECT_HUBS.find((h) => h.type === type);
  if (!hub) notFound();
  const table = objectTable(hub.type as DomainKind, tag ? (e) => e.tags.some((x) => x.label === tag) : undefined);
  const tabs = OBJECT_HUBS.map((h) => ({ type: h.type as DomainKind, label: h.label, count: OBJECT_ITEMS.filter((o) => o.type === h.type).length }));
  return (
    <ObjectsView
      key={hub.type}
      type={hub.type as DomainKind}
      tabs={tabs}
      table={table}
      total={OBJECT_ITEMS.length}
      folder={hub.folder}
      filter={tag ? { label: tag, clearHref: objectHref(hub.type) } : undefined}
    />
  );
}
