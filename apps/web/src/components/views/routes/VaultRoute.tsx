"use client";

import { useMemo } from "react";
import { redirect } from "next/navigation";
import { Page, PageTitle, ViewPlaceholder } from "@/components/shell/Page";
import { FolderChips, type SubFolder } from "@/components/views/FolderChips";
import { SpaceView } from "@/components/views/SpaceView";
import { noteEntry, objectEntry, sortNewest, type ViewEntry } from "@/components/views/entries";
import type { MockObject } from "@/lib/mock/objects";
import { VAULT_ROOT, pillClass, type VaultFolder } from "@/lib/workspace-data";
import { noteHrefById, vaultHref } from "@/lib/shell/routes";
import { useSnapshot } from "@/lib/supabase/useSnapshot";
import { t, tn } from "@/i18n";

/** Direct subfolders: the tree's children plus any folder that only exists through its files. */
function subFolders(full: string, tree: readonly VaultFolder[], all: readonly ViewEntry[]): SubFolder[] {
  const prefix = full + "/";
  const names = new Set<string>();
  tree.forEach((f) => f.path.startsWith(prefix) && names.add(f.path.slice(prefix.length).split("/")[0]!));
  all.forEach((e) => {
    const rest = e.path.startsWith(prefix) ? e.path.slice(prefix.length) : null;
    if (rest?.includes("/")) names.add(rest.split("/")[0]!);
  });
  return [...names]
    .sort()
    .map((name) => ({ name, path: prefix + name, count: all.filter((e) => e.path.startsWith(prefix + name + "/")).length }));
}

/* Vault Explorer: a folder shows its subfolders and files in the three views, a file shows the (later) reader / note view. */
export function VaultRoute({ path, tag }: { path: string[]; tag?: string }) {
  const snap = useSnapshot();
  const segs = path.map((s) => decodeURIComponent(s));
  const full = segs.join("/");
  const isFile = /\.(md|pdf|epub)$/i.test(full);
  const all = useMemo(
    () => [...snap.notes.map(noteEntry), ...snap.objects.map((o) => objectEntry(o as MockObject))],
    [snap],
  );
  const { entries, folders } = useMemo(() => {
    if (isFile) return { entries: [], folders: [] };
    let list = all.filter((e) => e.path.startsWith(full + "/"));
    if (tag) list = list.filter((e) => e.tags.some((x) => x.label === tag));
    return { entries: sortNewest(list), folders: subFolders(full, snap.vaultTree, all) };
  }, [all, full, isFile, snap.vaultTree, tag]);
  const crumbs = [
    { label: VAULT_ROOT },
    ...segs.map((s, i) => ({ label: s, href: i < segs.length - 1 ? vaultHref(segs.slice(0, i + 1).join("/")) : undefined })),
  ];
  if (isFile) {
    // Known files (notes and 70_Objects) open as the note page; the vault path is only their address.
    const item = [...snap.notes, ...snap.objects].find((n) => n.path === full);
    if (item) redirect(noteHrefById(item.id));
    return (
      <Page>
        <PageTitle crumbs={crumbs} title={segs[segs.length - 1]} />
        <ViewPlaceholder what={t("The note and reader view (BlockNote editor, PDF/EPUB reader)")} />
      </Page>
    );
  }
  return (
    <SpaceView
      key={full}
      scope={`vault:${full}`}
      densityScope="spaces:vault"
      crumbs={crumbs}
      title={segs[segs.length - 1]}
      help={tn(entries.length, "{n} entry", "{n} entries")}
      entries={entries}
      filters={tag ? [{ label: tag, cls: pillClass(tag), clearHref: vaultHref(full) }] : []}
      resetHref={vaultHref(full)}
      before={<FolderChips folders={folders} />}
      emptyArt="sync"
      emptyText={t("This folder is empty. Kortex files new entries in the right place automatically.")}
    />
  );
}
