import { t, tn, tx } from "../i18n";
import { useLocale } from "../i18n/device";
import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { Animated, Platform, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { tick } from "../lib/haptics";
import { useRouter } from "expo-router";
import { FILTER_CHIPS, SORTS, tagTone, type Entry } from "../data/mock";
import { dropChip } from "../lib/search";
import type { EntryScope } from "../state/AppState";
import { alpha } from "../theme/color";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { useChrome } from "../ui/Chrome";
import { Icon } from "../ui/Icon";
import { Btn, FadeIn, glass, Help, HeroSide, HeroTop, Micro, Photo, Pill, ring, Segmented, T } from "../ui/primitives";
import { ScreenScroll } from "../ui/Screen";
import { useHeaderH } from "../ui/Shell";
import { SelectionBar } from "../ui/SelectionBar";
import { SwipeRow } from "../ui/SwipeRow";
import type { useEntryActions } from "../ui/entryActions";
import { folderTrail, parentFolder } from "../lib/links";
import { LibraryRuhe } from "./ruhe/LibraryRuhe";
import { CHIP_LABEL, EMPTY, SORT_LABEL, SUGGESTIONS, useLibraryModel, VIEWS } from "./libraryModel";

/*
 * Einträge (Mobile.dc.html "Tab: Einträge"): smart search, filter chips, list / grid / timeline.
 * G4: the scope switch shows all entries, the starred ones (Favoriten) or the archived ones (Archiv).
 * "Ordner" browses the vault's folder tree like the web sidebar: subfolders first, then the folder's entries.
 */

const SCOPES: { key: EntryScope; label: () => string; icon?: "star" | "archive" | "folder" }[] = [
  { key: "all", label: () => t("All") },
  { key: "favorites", label: () => t("Favorites"), icon: "star" },
  { key: "folders", label: () => t("Folders"), icon: "folder" },
  { key: "archive", label: () => tx("scope", "Archive"), icon: "archive" },
];

/** Height of the controls row (filter chips, view and sort); it pins under the header when the list scrolls. */
const CTRL_H = 52;


type RowHandlers = { press: (id: string) => void; hold: (id: string) => void; swipe: ReturnType<typeof useEntryActions>["swipe"] };

/** One list row: memoised, so a long list does not rebuild every row and its swipe gestures on each change. */
const EntryRow = memo(function EntryRow({ e, selected, h }: { e: Entry; selected: boolean; h: RefObject<RowHandlers> }) {
  const th = useTheme();
  useLocale();
  return (
    <SwipeRow onPress={() => h.current.press(e.id)} onLongPress={() => h.current.hold(e.id)} {...h.current.swipe(e)}>
      <View style={[{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, boxShadow: `inset 0 -1px 0 0 ${th.borderSubtle}` } as ViewStyle, selected ? ({ backgroundColor: th.accentAiSoft } as ViewStyle) : null]}>
        <View style={{ width: 60, height: 60, borderRadius: RADIUS.lg, overflow: "hidden", backgroundColor: th.bgSurfaceMuted }}>
          <Photo source={e.img} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <T size={14} lh={18} weight={500} numberOfLines={1}>
            {e.title}
          </T>
          <Help numberOfLines={1}>{`${e.type} · ${e.when}`}</Help>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Pill sm tone={tagTone(e.tag)}>
              {e.tag}
            </Pill>
            {e.fav && <Icon name="star" size={12} color={th.textMuted} />}
          </View>
        </View>
        {selected && <Icon name="check" size={18} color={th.accentAi} />}
      </View>
    </SwipeRow>
  );
});

/** The Einträge tab: Ruhe gets its own Bibliothek screen, Vivid keeps this one. */
export function Entries() {
  return useRuhe() ? <LibraryRuhe /> : <EntriesVivid />;
}

function EntriesVivid() {
  const th = useTheme();
  const { top } = useChrome();
  const router = useRouter();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [rowY, setRowY] = useState(0);
  const headerH = useHeaderH();
  const pinTop = top + headerH;
  const span = Math.max(1, rowY - pinTop);
  const pin = scrollY.interpolate({ inputRange: [0, span], outputRange: [rowY, pinTop], extrapolate: "clamp" });
  const bar = scrollY.interpolate({ inputRange: [Math.max(0, span - 12), span], outputRange: [0, 1], extrapolate: "clamp" });
  const m = useLibraryModel({ ruhe: false });
  const { a, act, focused, folder, setFolder, paths, folderBusy, inFolderLive, subfolders, browse, source, list, state, answer, hasQuery, firstLoad, shown, more, sel, press, hold } = m;
  const curView = VIEWS.find((v) => v.key === a.view) ?? VIEWS[0]!;
  const groups = m.groups;
  const sortLabel = t(SORT_LABEL[a.sort] ?? "");
  const rowH = useRef<RowHandlers>(null!);
  rowH.current = { press, hold, swipe: act.swipe };
  const chosenRing = (id: string) => (sel.has(id) ? ring(th.accentAi, 2) : null);

  return (
    <>
    <ScreenScroll padTop={6} gap={12} scrollY={scrollY} onNearEnd={more}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T type="h1" style={{ flex: 1 }}>
          {t("Entries")}
        </T>
        <T num size={12} lh={16} ls={0} color={th.textMuted}>
          {hasQuery ? tn(list.length, "{n} hit", "{n} hits") : t("{shown} of {total}", { shown: list.length, total: source.length })}
        </T>
        <Btn iconOnly icon="plus" accessibilityLabel={t("New note")} onPress={() => router.push("/editor")} />
      </View>

      <Segmented label={t("Category")} value={a.scope} onChange={a.setScope} items={SCOPES.map((x) => ({ key: x.key, label: x.label(), icon: x.icon }))} fill />

      {hasQuery ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Help>{t("Kortex understands:")}</Help>
            {state.chips.map((c) => (
              <Pill key={c.label} sm nodot={!c.tag} minHeight={36} tone={c.tag ? tagTone(c.tag) : "ai"} accessibilityLabel={t("Remove {label}", { label: c.label })} onPress={() => a.setQ(dropChip(a.q, c))} style={{ gap: 4, paddingHorizontal: 10, backgroundColor: th.bgSurfaceMuted }}>
                <T size={12} lh={18} ls={0} color={th.textSecondary}>
                  {c.label}
                </T>
                <Icon name="x" size={11} color={th.textMuted} />
              </Pill>
            ))}
          </View>
          {!!answer && (
            <FadeIn>
              <View style={{ gap: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: RADIUS.xl, backgroundColor: th.accentAiSoft }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon name="sparkles" size={14} color={th.tags.ai.fg} />
                  <T size={12} lh={18} weight={500} color={th.tags.ai.fg}>
                    {t("Smart search")}
                  </T>
                </View>
                <T size={14} lh={21} weight={500}>
                  {answer}
                </T>
              </View>
            </FadeIn>
          )}
        </>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 6 }}>
          {SUGGESTIONS.map((s) => t(s)).map((l) => (
            <Pressable key={l} onPress={() => a.setQ(l)} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
              <Icon name="sparkles" size={14} color={th.tags.ai.fg} />
              <T size={12} lh={18} ls={0} color={th.textSecondary}>
                {l}
              </T>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Placeholder: the real controls row is the overlay below, which pins under the header once scrolled (K2). */}
      <View onLayout={(e) => setRowY(e.nativeEvent.layout.y)} style={{ height: CTRL_H }} />

      {browse && !hasQuery && (
        <View style={{ gap: 6 }}>
          {!!folder && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Btn iconOnly variant="ghost" icon="chev" accessibilityLabel={t("Up one folder")} onPress={() => setFolder(parentFolder(folder))} style={{ transform: [{ rotate: "180deg" }] }} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", gap: 2 }}>
                <Pressable accessibilityRole="button" onPress={() => setFolder("")} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 6 }}>
                  <T size={13} lh={18} ls={0} color={th.textSecondary}>
                    {t("Vault")}
                  </T>
                </Pressable>
                {folderTrail(folder).map((f, i, all) => (
                  <View key={f.path} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    <T size={13} lh={18} ls={0} color={th.textMuted}>
                      /
                    </T>
                    <Pressable accessibilityRole="button" onPress={() => setFolder(f.path)} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 6 }}>
                      <T size={13} lh={18} ls={0} weight={i === all.length - 1 ? 500 : 400} color={i === all.length - 1 ? th.textPrimary : th.textSecondary}>
                        {f.label}
                      </T>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
          {subfolders.map((f) => (
            <Pressable
              key={f.path}
              accessibilityRole="button"
              accessibilityLabel={t("Open folder {name}", { name: f.label })}
              onPress={() => setFolder(f.path)}
              style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceFlat }}
            >
              <Icon name="folder" size={18} color={th.textSecondary} />
              <T size={14} lh={20} weight={500} numberOfLines={1} style={{ flex: 1 }}>
                {f.label}
              </T>
              <Icon name="chev" size={14} color={th.textMuted} />
            </Pressable>
          ))}
          {!paths && <Help>{t("Loading folders")}</Help>}
          {!!folder && folderBusy && !inFolderLive.length && <Help>{t("Loading entries")}</Help>}
          {!!folder && !folderBusy && !inFolderLive.length && !subfolders.length && <Help>{t("This folder is empty.")}</Help>}
        </View>
      )}


      {firstLoad && <ListSkeleton />}

      {a.view === "list" && (
        <View>
          {shown.map((e) => (
            <EntryRow key={e.id} e={e} selected={sel.has(e.id)} h={rowH} />
          ))}
        </View>
      )}

      {a.view === "grid" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {shown.map((e) => (
            <Pressable key={e.id} onPress={() => press(e.id)} onLongPress={() => hold(e.id)} accessibilityState={{ selected: sel.has(e.id) }} style={[{ width: "48.5%", flexGrow: 1, height: 184, borderRadius: RADIUS.card, overflow: "hidden", backgroundColor: th.bgSurfaceFlat } as ViewStyle, chosenRing(e.id)]}>
              <HeroTop source={e.img} heroH="58%" bg={th.bgSurfaceFlat} style={{ flex: 1 }}>
                <View style={{ position: "absolute", left: 10, right: 10, bottom: 10, gap: 3 }}>
                  <T type="meta" color={th.textMuted}>{`${e.type} · ${e.whenShort}`}</T>
                  <T size={14} lh={20} weight={500} numberOfLines={2}>
                    {e.title}
                  </T>
                </View>
              </HeroTop>
            </Pressable>
          ))}
        </View>
      )}

      {a.view === "time" && (
        <View style={{ gap: 14 }}>
          {groups.map((g) => (
            <View key={g.label} style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <T size={14} lh={20} weight={500} color={th.tags.ai.fg}>
                  {g.label}
                </T>
                <Help>{tn(g.items.length, "{n} entry", "{n} entries")}</Help>
              </View>
              <View style={{ gap: 8, paddingLeft: 14, marginLeft: 4, boxShadow: `inset 1px 0 0 0 ${th.borderSubtle}` } as ViewStyle}>
                {g.items.map((e) => (
                  <Pressable key={e.id} onPress={() => press(e.id)} onLongPress={() => hold(e.id)} accessibilityState={{ selected: sel.has(e.id) }} style={[{ gap: 3, paddingVertical: 10, paddingLeft: 12, paddingRight: "34%", borderRadius: RADIUS.lg, backgroundColor: th.bgSurfaceFlat, overflow: "hidden" } as ViewStyle, chosenRing(e.id)]}>
                    <HeroSide source={e.img} heroW="30%" bg={th.bgSurfaceFlat} />
                    <View style={{ position: "absolute", left: -19, top: 16, width: 9, height: 9, borderRadius: 5, backgroundColor: th.accentAi, boxShadow: `0 0 0 3px ${th.bgMainWindow}` } as ViewStyle} />
                    <T type="meta" color={th.textMuted}>{`${e.time} · ${e.type}`}</T>
                    <T size={14} lh={20} weight={500}>
                      {e.title}
                    </T>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {list.length === 0 && a.scope !== "all" && a.scope !== "folders" && !hasQuery && (
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 28, paddingHorizontal: 12 }}>
          <Icon name={a.scope === "archive" ? "archive" : "star"} size={22} color={th.textMuted} />
          <T size={15} lh={22} weight={500}>
            {t(EMPTY[a.scope][0])}
          </T>
          <Help style={{ textAlign: "center" }}>{t(EMPTY[a.scope][1])}</Help>
        </View>
      )}

      {list.length === 0 && !firstLoad && (a.scope === "all" || hasQuery) && (
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
          <Help>{t("No hits in your vault.")}</Help>
          <Btn
            variant="ai"
            sm
            icon="sparkles"
            onPress={() => {
              const q = a.q;
              a.setQ("");
              router.navigate("/ask");
              a.ask(q);
            }}
          >
            {t("Ask Kortex instead")}
          </Btn>
        </View>
      )}
    </ScreenScroll>
    <Animated.View pointerEvents={focused ? "box-none" : "none"} style={{ position: "absolute", left: 0, right: 0, top: 0, height: CTRL_H, zIndex: 5, opacity: rowY && focused ? 1 : 0, transform: [{ translateY: pin }] }}>
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(th.bgMainWindow, 0.94), opacity: bar, boxShadow: `inset 0 -1px 0 0 ${th.borderSubtle}` } as never} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: CTRL_H, paddingLeft: 18, paddingRight: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, alignItems: "center", paddingRight: 8 }}>
          {FILTER_CHIPS.map(([k]) => {
            const label = t(CHIP_LABEL[k] ?? k);
            const on = a.chip === k;
            return (
              <Pressable
                key={k}
                accessibilityState={{ selected: on }}
                onPress={() => {
                  if (!on) tick();
                  a.setChip(k);
                }}
                style={({ pressed }) => ({ minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: on ? th.bgSurfaceMuted : pressed ? alpha(th.textPrimary, 0.06) : "transparent" })}
              >
                <T size={13} lh={18} ls={0} weight={on ? 500 : 400} color={on ? th.textPrimary : th.textSecondary}>
                  {label}
                </T>
              </Pressable>
            );
          })}
        </ScrollView>
        {/* Soft edge where the chip row runs under the buttons: reads as "scrolls on", not as cut-off text. */}
        <LinearGradient pointerEvents="none" start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} colors={[alpha(th.bgMainWindow, 0), th.bgMainWindow]} style={{ position: "absolute", right: 112, top: 8, bottom: 8, width: 28 }} />
        <Btn iconOnly variant="ghost" icon={curView.icon} accessibilityLabel={t("View: {view}, switch", { view: t(curView.aria) })} onPress={() => a.setView(VIEWS[(VIEWS.indexOf(curView) + 1) % VIEWS.length]!.key)} />
        <Btn iconOnly variant="ghost" icon="sort" accessibilityLabel={t("Sort: {order}", { order: sortLabel })} onPress={() => a.setSortOpen(!a.sortOpen)} />
      </View>
      {a.sortOpen && (
        <FadeIn style={{ position: "absolute", right: 12, top: CTRL_H - 4, zIndex: 5, minWidth: 200 }}>
          <View accessibilityRole="menu" accessibilityLabel={t("Sort")} style={[{ minWidth: 200, padding: 4, borderRadius: RADIUS.xl, boxShadow: th.shadowFloating } as ViewStyle, glass(th)]}>
            <Micro style={{ paddingTop: 8, paddingHorizontal: 8, paddingBottom: 4 }}>{t("Sort by")}</Micro>
            {SORTS.map(([k]) => {
              const label = t(SORT_LABEL[k] ?? k);
              const on = a.sort === k;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    a.setSort(k as never);
                    a.setSortOpen(false);
                  }}
                  style={{ height: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, borderRadius: RADIUS.lg, backgroundColor: on ? th.accentAiSoft : "transparent" }}
                >
                  <T size={14} lh={21}>
                    {label}
                  </T>
                  {on && (
                    <View style={{ marginLeft: "auto" }}>
                      <Icon name="check" size={14} color={th.tags.ai.fg} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </FadeIn>
      )}
    </Animated.View>
    {sel.active && <SelectionBar count={sel.count} total={sel.total} actions={act.bar(sel.ids, sel.clear)} onAll={sel.all} onClose={sel.clear} />}
    </>
  );
}

/** Placeholder rows while the first live load runs (same geometry as EntryRow, so nothing jumps when data arrives). */
function ListSkeleton() {
  const th = useTheme();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const bar = (w: `${number}%`, h: number) => <View style={{ width: w, height: h, borderRadius: 4, backgroundColor: th.bgSurfaceMuted }} />;
  return (
    <Animated.View accessibilityLabel={t("Loading entries")} style={{ opacity: pulse }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
          <View style={{ width: 60, height: 60, borderRadius: RADIUS.lg, backgroundColor: th.bgSurfaceMuted }} />
          <View style={{ flex: 1, gap: 8 }}>
            {bar(i % 2 ? "62%" : "78%", 12)}
            {bar("44%", 10)}
            {bar("24%", 10)}
          </View>
        </View>
      ))}
    </Animated.View>
  );
}
