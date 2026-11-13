import { redirect } from "next/navigation";
import { Page, PageTitle, ViewPlaceholder } from "@/components/shell/Page";
import { FolderChips, type SubFolder } from "@/components/views/FolderChips";
import { SpaceView } from "@/components/views/SpaceView";
import { objectEntries, noteEntry, sortNewest } from "@/components/views/entries";
import { ALL_ITEMS, NOTES, VAULT_ROOT, VAULT_TREE, pillClass } from "@/lib/workspace-data";
import { noteHrefById, vaultHref } from "@/lib/shell/routes";
import { loadWorkspace } from "@/lib/supabase/workspace";
import { t, tn } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata({ params }: { params: Promise<{ path: string[] }> }) {
  enterRequestLocale(await requestLocale());
  await loadWorkspace();
  const { path } = await params;
  return { title: decodeURIComponent(path[path.length - 1] ?? "Vault") };
}

/** Per request: the notes come from the signed-in user's snapshot. */
const allEntries = () => [...NOTES.map(noteEntry), ...objectEntries()];

/** Direct subfolders: the tree's children plus any folder that only exists through its files. */
function subFolders(full: string): SubFolder[] {
  const ALL_ENTRIES = allEntries();
  const prefix = full + "/";
  const names = new Set<string>();
  VAULT_TREE.forEach((f) => f.path.startsWith(prefix) && names.add(f.path.slice(prefix.length).split("/")[0]!));
  ALL_ENTRIES.forEach((e) => {
    const rest = e.path.startsWith(prefix) ? e.path.slice(prefix.length) : null;
    if (rest?.includes("/")) names.add(rest.split("/")[0]!);
  });
  return [...names]
    .sort()
    .map((name) => ({ name, path: prefix + name, count: ALL_ENTRIES.filter((e) => e.path.startsWith(prefix + name + "/")).length }));
}

/* Vault Explorer: a folder shows its subfolders and files in the three views, a file shows the (later) reader / note view. */
export default async function VaultPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  enterRequestLocale(await requestLocale());
  await loadWorkspace();
  const [{ path }, { tag }] = await Promise.all([params, searchParams]);
  const segs = path.map((s) => decodeURIComponent(s));
  const full = segs.join("/");
  const isFile = /\.(md|pdf|epub)$/i.test(full);
  const crumbs = [
    { label: VAULT_ROOT },
    ...segs.map((s, i) => ({ label: s, href: i < segs.length - 1 ? vaultHref(segs.slice(0, i + 1).join("/")) : undefined })),
  ];
  if (isFile) {
    // Known files (notes and 70_Objects) open as the note page; the vault path is only their address.
    const item = ALL_ITEMS.find((n) => n.path === full);
    if (item) redirect(noteHrefById(item.id));
    const note = NOTES.find((n) => n.path === full);
    return (
      <Page>
        <PageTitle crumbs={crumbs} title={note?.title ?? segs[segs.length - 1]} help={note?.tldr} />
        <ViewPlaceholder what={t("The note and reader view (BlockNote editor, PDF/EPUB reader)")} />
      </Page>
    );
  }
  let list = allEntries().filter((e) => e.path.startsWith(full + "/"));
  if (tag) list = list.filter((e) => e.tags.some((x) => x.label === tag));
  const entries = sortNewest(list);
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
      before={<FolderChips folders={subFolders(full)} />}
      emptyText={t("This folder is empty. Kortex files new entries in the right place automatically.")}
    />
  );
}
