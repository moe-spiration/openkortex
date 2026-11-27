import { msg, t, tx } from "../../i18n";
import { useMemo, useRef, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { FILTER_CHIPS, SORTS, type Entry } from "../../data/mock";
import { dropChip } from "../../lib/search";
import { folderTrail, parentFolder } from "../../lib/links";
import { lensFilters, lensOf, mixesOf, weekOf, type Lens } from "../../lib/library";
import { tick } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../../ui/Icon";
import { FadeIn, Spinner, T } from "../../ui/primitives";
import { ScreenScroll } from "../../ui/Screen";
import { SelectionBar } from "../../ui/SelectionBar";
import { LibCard, LibRow, MixesRail, SearchField, TimeRow, WeekBand } from "../../ui/RuheLibrary";
import type { useEntryActions } from "../../ui/entryActions";
import { CHIP_LABEL, EMPTY, SORT_LABEL, SUGGESTIONS, useLibraryModel, VIEWS } from "../libraryModel";
import { EmptyState, GroupHead, RButton, RChipRow, RRow, RSegment, RSkeletonRows, RuheLocBar, SyncLine } from "../../ui/ruhe";
import { RUHE_SPACE } from "../../theme/tokens";

const PAD = { text: RUHE_SPACE.page, surface: RUHE_SPACE.surface };

/*
 * Bibliothek, Ruhe (mockups 08 "Einträge" and 24 "Bibliothek", android-richtlinien.md 7, 8 A and 12): large title with
 * search and "…", the lens segment Typen / Objekte / Vault full width under it, filter chips (the inbox is a chip
 * here, mockup 08), Smart Mixes and the week band, then the list grouped by day (62 rows), the two-column grid or
 * the timeline. The Suche tab is the same screen with the search field in front. Vault: the folders as on the PC.
 */

type RowHandlers = { press: (id: string) => void; hold: (id: string) => void; swipe: ReturnType<typeof useEntryActions>["swipe"] };

const LENSES: { key: Lens; label: string; icon: "shapes" | "users" | "folder" }[] = [
  { key: "types", label: msg("Types"), icon: "shapes" },
  { key: "objects", label: msg("Objects"), icon: "users" },
  { key: "vault", label: msg("Vault"), icon: "folder" },
];

export function LibraryRuhe() {
  const th = useTheme();
  const router = useRouter();
  const m = useLibraryModel({ ruhe: true });
  const { a, d, act, sel, list, shown, groups, hasQuery, browse, folder, setFolder } = m;
  const lens = lensOf(a.scope, a.chip);
  const search = a.searchOpen;
  const mixes = useMemo(() => mixesOf(d.entries), [d.entries]);
  const week = useMemo(() => weekOf(d.entries), [d.entries]);
  const rowH = useRef<RowHandlers>(null!);
  rowH.current = { press: m.press, hold: m.hold, swipe: act.swipe };
  const plain = a.scope === "all" && a.chip === "all" && !m.mixTag && m.dayPick === null;
  const clearFilters = () => {
    m.setMixTag(null);
    m.setDayPick(null);
  };
  const setLens = (l: Lens) => {
    const f = lensFilters(l);
    a.setScope(f.scope);
    a.setChip(f.chip);
    clearFilters();
    setFolder("");
  };
  const more = () =>
    a.openMenu({
      title: t("Library"),
      items: [
        { label: t("New note"), icon: "plus", run: () => router.push("/editor") },
        ...VIEWS.filter((v) => v.key !== a.view).map((v) => ({ label: t("View: {view}", { view: t(v.aria) }), icon: v.icon, run: () => a.setView(v.key) })),
        { label: t("Sort: {order}", { order: t(SORT_LABEL[a.sort] ?? "") }), icon: "sort", run: () => a.setSort(SORTS[(SORTS.findIndex(([k]) => k === a.sort) + 1) % SORTS.length]![0] as never) },
        { label: t("Favorites"), icon: "star", run: () => a.setScope("favorites") },
        { label: tx("scope", "Archive"), icon: "archive", run: () => a.setScope("archive") },
        { label: t("Inbox"), icon: "inbox", run: () => router.navigate("/inbox") },
      ],
    });
  const actions = [
    search
      ? {
          icon: "x" as const,
          label: t("Close search"),
          onPress: () => {
            a.setQ("");
            a.setSearchOpen(false);
          },
        }
      : {
          icon: "search" as const,
          label: t("Smart search"),
          onPress: () => {
            tick();
            a.setSearchOpen(true);
          },
        },
    { icon: "more" as const, label: t("More"), onPress: more },
  ];

  const rows = (items: Entry[]) => items.map((e, i) => <LibRow key={e.id} e={e} first={i === 0} selected={sel.has(e.id)} h={rowH} />);
  const listBody = () => {
    if (a.view === "grid") {
      const pairs: Entry[][] = [];
      for (let i = 0; i < shown.length; i += 2) pairs.push(shown.slice(i, i + 2));
      return (
        <View style={{ gap: 16, paddingHorizontal: PAD.surface, paddingTop: 12 }}>
          {pairs.map((p) => (
            <View key={p[0]!.id} style={{ flexDirection: "row", gap: 12 }}>
              {p.map((e) => (
                <LibCard key={e.id} e={e} selected={sel.has(e.id)} onPress={() => m.press(e.id)} onLongPress={() => m.hold(e.id)} />
              ))}
              {p.length === 1 && <View style={{ flex: 1 }} />}
            </View>
          ))}
        </View>
      );
    }
    if (a.view === "time")
      return groups.map((g) => (
        <View key={g.label}>
          <GroupHead label={g.label} count={g.items.length} />
          {g.items.map((e, i) => (
            <TimeRow key={e.id} e={e} first={i === 0} last={i === g.items.length - 1} selected={sel.has(e.id)} onPress={() => m.press(e.id)} onLongPress={() => m.hold(e.id)} />
          ))}
        </View>
      ));
    if (lens === "objects" && !hasQuery) {
      const byType = new Map<string, Entry[]>();
      for (const e of shown) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
      return [...byType].map(([type, items]) => (
        <View key={type}>
          <GroupHead label={type} count={items.length} />
          {rows(items)}
        </View>
      ));
    }
    if (!hasQuery && (a.sort === "rel" || a.sort === "new"))
      return groups.map((g) => (
        <View key={g.label}>
          <GroupHead label={g.label} count={g.items.length} />
          {rows(g.items)}
        </View>
      ));
    return <View style={{ paddingTop: 6 }}>{rows(shown)}</View>;
  };

  let body: ReactNode;
  if (search && !hasQuery) {
    body = (
      <>
        <GroupHead label={t("Try")} />
        {SUGGESTIONS.map((s, i) => (
          <RRow key={s} icon="sparkles" titleWeight={400} title={t(s)} first={i === 0} onPress={() => a.setQ(t(s))} />
        ))}
      </>
    );
  } else {
    body = (
      <>
        {hasQuery && (
          <View style={{ gap: 10, paddingTop: 12 }}>
            {!!m.state.chips.length && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: PAD.surface, gap: 6, alignItems: "center" }}>
                <T size={12.5} lh={18} ls={0} weight={400} color={th.t3}>
                  {t("Kortex understands:")}
                </T>
                {m.state.chips.map((c) => (
                  <Pressable key={c.label} accessibilityRole="button" accessibilityLabel={t("Remove {label}", { label: c.label })} onPress={() => a.setQ(dropChip(a.q, c))} hitSlop={{ top: 8, bottom: 8 }} style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: th.name === "dark" ? th.lum2 : th.lum3 }}>
                    <T size={12.5} lh={16} ls={0} weight={400} color={th.t2}>
                      {c.label}
                    </T>
                    <Icon name="x" size={11} color={th.t3} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {!!m.answer && (
              <FadeIn>
                <View style={{ marginHorizontal: PAD.surface, gap: 4, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: th.accentSoft }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Icon name="sparkles" size={13} color={th.accentInk} />
                    <T size={12} lh={16} ls={0} weight={500} color={th.accentInk}>
                      {t("Smart search")}
                    </T>
                  </View>
                  <T size={14} lh={21} ls={0} weight={400}>
                    {m.answer}
                  </T>
                </View>
              </FadeIn>
            )}
          </View>
        )}

        {browse && !hasQuery && (
          <View>
            <SyncLine text={t("Folders as in your vault on the computer")} />
            {!!folder && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 12 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={t("Up one folder")} onPress={() => setFolder(parentFolder(folder))} style={{ height: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6 }}>
                  <Icon name="chev" size={16} rotate={180} color={th.accentInk} />
                  <T size={14} lh={18} ls={0} weight={400} color={th.accentInk}>
                    {t("Vault")}
                  </T>
                </Pressable>
                {folderTrail(folder).map((f, i, all) => (
                  <View key={f.path} style={{ flexDirection: "row", alignItems: "center" }}>
                    <T size={14} lh={18} ls={0} weight={400} color={th.t4}>
                      /
                    </T>
                    <Pressable accessibilityRole="button" onPress={() => setFolder(f.path)} style={{ height: 36, justifyContent: "center", paddingHorizontal: 6 }}>
                      <T size={14} lh={18} ls={0} weight={400} color={i === all.length - 1 ? th.t1 : th.t2}>
                        {f.label}
                      </T>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
            {m.subfolders.map((f, i) => (
              <RRow key={f.path} icon="folder" titleWeight={400} title={folder ? f.label : (f.path.split("/").pop() ?? f.label)} first={i === 0} chevron accessibilityLabel={t("Open folder {name}", { name: f.label })} onPress={() => setFolder(f.path)} />
            ))}
            {!m.paths && (
              <View style={{ paddingVertical: 24, alignItems: "center" }}>
                <Spinner />
              </View>
            )}
            {!!folder && m.folderBusy && !m.inFolderLive.length && (
              <View style={{ paddingVertical: 24, alignItems: "center" }}>
                <Spinner />
              </View>
            )}
            {!!folder && !m.folderBusy && !m.inFolderLive.length && !m.subfolders.length && <EmptyState icon="folder" pic="inbox" size="md" title={t("This folder is empty.")} />}
            {/* Vault synchron: at the root of the vault, under the folders. */}
            {!folder && !!m.paths && <EmptyState icon="sync" pic="sync" size="sm" title={t("Vault in sync")} help={t("Markdown on your computer and Kortex exchange every change.")} />}
          </View>
        )}

        {m.firstLoad && <RSkeletonRows n={6} />}
        {(!browse || !!folder || hasQuery) && listBody()}

        {list.length === 0 && (a.scope === "favorites" || a.scope === "archive") && !hasQuery && <EmptyState icon={a.scope === "archive" ? "archive" : "star"} pic={a.scope === "archive" ? "stack" : "idea"} title={t(EMPTY[a.scope][0])} help={t(EMPTY[a.scope][1])} action={{ label: t("All"), onPress: () => a.setScope("all") }} />}
        {list.length === 0 && !m.firstLoad && (a.scope === "all" || hasQuery) && (
          <EmptyState
            icon="search"
            pic="search"
            title={t("No hits in your vault.")}
            action={
              hasQuery
                ? {
                    label: t("Ask Kortex instead"),
                    onPress: () => {
                      const q = a.q;
                      a.setQ("");
                      router.navigate("/ask");
                      a.ask(q);
                    },
                  }
                : !plain
                  ? { label: t("All"), onPress: clearFilters }
                  : undefined
            }
          />
        )}
      </>
    );
  }

  return (
    <>
      <ScreenScroll flush padTop={0} onNearEnd={m.more}>
        <RuheLocBar title={search ? t("Search") : t("Library")} actions={actions} />
        {search ? <SearchField value={a.q} onChange={a.setQ} onClear={() => a.setQ("")} /> : <RSegment label={t("Lens")} value={lens} onChange={setLens} items={LENSES.map((l) => ({ key: l.key, label: t(l.label), icon: l.icon }))} style={{ marginTop: 2, marginHorizontal: PAD.surface }} />}
        {!search && lens === "types" && !hasQuery && (
          <View style={{ paddingTop: 12 }}>
            <RChipRow
              items={[
                { key: "all", label: t("All"), on: plain, onPress: () => (a.setScope("all"), a.setChip("all"), clearFilters()) },
                { key: "fav", label: t("Favorites"), on: a.scope === "favorites", onPress: () => (a.setScope("favorites"), a.setChip("all")) },
                ...(a.inboxCount > 0 ? [{ key: "inbox", label: t("Inbox"), count: a.inboxCount, on: false, onPress: () => router.navigate("/inbox") }] : []),
                ...FILTER_CHIPS.filter(([k]) => k !== "all" && k !== "object").map(([k]) => ({ key: k, label: t(CHIP_LABEL[k] ?? k), on: a.scope === "all" && a.chip === k, onPress: () => (a.setScope("all"), a.setChip(k)) })),
                { key: "archive", label: tx("scope", "Archive"), on: a.scope === "archive", onPress: () => (a.setScope("archive"), a.setChip("all")) },
              ]}
            />
          </View>
        )}
        {!search && lens === "types" && !hasQuery && a.scope === "all" && a.chip === "all" && (
          <View style={{ gap: 14, paddingTop: 14 }}>
            <MixesRail mixes={mixes} active={m.mixTag} onPick={(tag) => m.setMixTag((x) => (x === tag ? null : tag))} />
            <WeekBand days={week} picked={m.dayPick} onPick={(ago) => m.setDayPick((p) => (p === ago ? null : ago))} />
          </View>
        )}
        {body}
        {a.view === "list" && list.length > shown.length && (
          <View style={{ alignItems: "center", paddingTop: 12 }}>
            <RButton variant="ghost" size="sm" label={t("Show more")} onPress={m.more} />
          </View>
        )}
      </ScreenScroll>
      {sel.active && <SelectionBar count={sel.count} total={sel.total} actions={act.bar(sel.ids, sel.clear)} onAll={sel.all} onClose={sel.clear} />}
    </>
  );
}
