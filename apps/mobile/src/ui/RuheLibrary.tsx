import { intlLocale, msg, t, tn } from "../i18n";
import { memo, type RefObject } from "react";
import { Platform, Pressable, ScrollView, TextInput, View, type ViewStyle } from "react-native";
import { tagTone, type Entry } from "../data/mock";
import type { Mix, WeekDay } from "../lib/library";
import { useLocale } from "../i18n/device";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { FONT } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Photo, T } from "./primitives";
import { SwipeRow } from "./SwipeRow";
import { typeIconName } from "./typeIcon";
import type { useEntryActions } from "./entryActions";

/*
 * Ruhe Bibliothek on Android (mockup screens 08 and 24, android-richtlinien.md sections 4, 7 and 12): Smart Mixes as
 * 112 collage tiles, the week band, list rows with a free monochrome type icon (no tiles, no photos), the two-column
 * grid with the title under a 104 image, and the timeline rows. Edge to edge: rows 20 from the edge, surfaces 16.
 */

const KIND_ICON: Record<Entry["kind"], IconName> = { note: "note", meeting: "mic", read: "book", ai: "sparkles", food: "flame", video: "play", object: "user" };
export const entryIcon = (e: Entry): IconName => (e.itemType ? typeIconName(e.itemType) : KIND_ICON[e.kind]);

const TNUM = { fontVariant: ["tabular-nums" as const] };

/** Search field of the Suche tab: 44 high, r12, a quiet surface; the query runs the smart search below it. */
export function SearchField({ value, onChange, onClear }: { value: string; onChange: (v: string) => void; onClear: () => void }) {
  const th = useTheme();
  return (
    <View style={{ height: 44, marginHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 4, borderRadius: 12, backgroundColor: th.name === "dark" ? th.lum2 : th.lum3 }}>
      <Icon name="search" size={16} color={th.t3} />
      <TextInput
        accessibilityLabel={t("Smart search")}
        autoFocus
        placeholder={t("Search or ask your vault")}
        placeholderTextColor={th.t4}
        selectionColor={th.accent}
        value={value}
        onChangeText={onChange}
        style={[{ flex: 1, minWidth: 0, height: 44, padding: 0, fontFamily: FONT.sans400, fontSize: 15, color: th.t1 }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
      />
      {!!value && (
        <Pressable accessibilityRole="button" accessibilityLabel={t("Clear search")} onPress={onClear} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <Icon name="x" size={14} color={th.t3} />
        </Pressable>
      )}
    </View>
  );
}

/** Collage cells [left, top, width, height] for one to four images in a 112 tile with 2 gaps (`.coll`). */
function collage(n: number): [number, number, number, number][] {
  if (n <= 1) return [[0, 0, 112, 112]];
  if (n === 2) return [[0, 0, 55, 112], [57, 0, 55, 112]];
  if (n === 3) return [[0, 0, 55, 112], [57, 0, 55, 55], [57, 57, 55, 55]];
  return [[0, 0, 55, 55], [57, 0, 55, 55], [0, 57, 55, 55], [57, 57, 55, 55]];
}

/** Smart Mixes (`.mmix`/`.mx`): 112 tiles r12, 10 apart; a tap filters the list by the mix, a second tap clears it. */
export function MixesRail({ mixes, active, onPick }: { mixes: Mix[]; active: string | null; onPick: (tag: string) => void }) {
  const th = useTheme();
  if (!mixes.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
      {mixes.map((m) => {
        const on = active === m.tag;
        return (
          <Pressable key={m.tag} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={t("Mix {name}, {n}", { name: m.label, n: m.count })} onPress={() => onPick(m.tag)} style={({ pressed }) => ({ width: 112, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            <View style={{ width: 112, height: 112, borderRadius: 12, overflow: "hidden", backgroundColor: th.name === "dark" ? th.lum3 : th.lum2, boxShadow: on ? `0 0 0 2px ${th.accent}` : undefined } as ViewStyle}>
              {m.imgs.length ? (
                collage(m.imgs.length).map((c, i) => (
                  <View key={i} style={{ position: "absolute", left: c[0], top: c[1], width: c[2], height: c[3], backgroundColor: th.lum3 }}>
                    <Photo source={m.imgs[i]!} />
                  </View>
                ))
              ) : (
                <View style={{ flex: 1, height: 112, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="tag" size={18} color={th.t3} />
                </View>
              )}
            </View>
            <T size={13} lh={18} ls={0} weight={500} numberOfLines={1} style={{ marginTop: 7 }} color={on ? th.accentInk : th.t1}>
              {m.label}
            </T>
            <T size={12} lh={16} ls={0} weight={400} color={th.t3} style={[{ marginTop: 1 }, TNUM]}>
              {tn(m.count, "{n} entry", "{n} entries")}
            </T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const WD = [msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat"), msg("Sun")];

/** Week band (`.mweek`): 7 columns, r14, lum2 (light lum1 + ring); today on the accent, up to three tag dots per day. */
export function WeekBand({ days, picked, onPick }: { days: WeekDay[]; picked: number | null; onPick: (ago: number) => void }) {
  const th = useTheme();
  useLocale();
  const dark = th.name === "dark";
  return (
    <View style={[{ marginHorizontal: 16, flexDirection: "row", paddingVertical: 8, paddingHorizontal: 4, borderRadius: 14, backgroundColor: dark ? th.lum2 : th.lum1 }, dark ? null : ({ boxShadow: `0 0 0 1px ${th.hairStrong}` } as ViewStyle)]}>
      {days.map((d) => {
        const on = picked === d.ago;
        const future = d.ago < 0;
        return (
          <Pressable key={d.weekday} disabled={future} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${t(WD[d.weekday]!)} ${d.date}`} onPress={() => onPick(d.ago)} style={{ flex: 1, alignItems: "center", gap: 2 }}>
            <T size={11} lh={14} ls={0} weight={400} color={th.t4}>
              {t(WD[d.weekday]!)}
            </T>
            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: d.today ? th.accentFill : on ? th.lum4 : "transparent" }}>
              <T size={14} lh={18} ls={0} weight={500} color={d.today ? th.onAccent : future ? th.t4 : th.t2} style={TNUM}>
                {String(d.date)}
              </T>
            </View>
            <View style={{ flexDirection: "row", gap: 2, height: 4 }}>
              {d.dots.map((tag, i) => (
                <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: th.tags[tagTone(tag)]?.dot ?? th.t3 }} />
              ))}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

type RowHandlers = { press: (id: string) => void; hold: (id: string) => void; swipe: ReturnType<typeof useEntryActions>["swipe"] };

/**
 * Entry row (`.mrow` at 62, mockup 08): free type icon 18 in t3, 12 to the text, title 15/500, one quiet line 12.5,
 * the time top right in t4 with tabular figures, the hairline only above the text column from row 2 on.
 */
export const LibRow = memo(function LibRow({ e, selected, first, h }: { e: Entry; selected: boolean; first: boolean; h: RefObject<RowHandlers> }) {
  const th = useTheme();
  useLocale();
  const sub = e.error ? e.error : e.tldr?.trim() || `${e.type} · ${e.when}`;
  return (
    <SwipeRow onPress={() => h.current.press(e.id)} onLongPress={() => h.current.hold(e.id)} {...h.current.swipe(e)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 62, paddingHorizontal: 20, backgroundColor: selected ? th.accentSoft : th.lum1 }}>
        <View style={{ width: 20, alignItems: "center" }}>{selected ? <Icon name="check" size={18} color={th.accent} /> : <Icon name={entryIcon(e)} size={18} color={th.t3} />}</View>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 10, alignSelf: "stretch", boxShadow: first ? undefined : `inset 0 1px 0 0 ${th.hair}` } as ViewStyle}>
          <View style={{ flex: 1, minWidth: 0, gap: 2, alignSelf: "center", paddingVertical: 10 }}>
            <T size={15} lh={20} ls={0} weight={500} numberOfLines={1}>
              {e.title}
            </T>
            <T size={12.5} lh={17} ls={0} weight={400} numberOfLines={1} color={e.error ? th.crit : th.t3}>
              {sub}
            </T>
          </View>
          <View style={{ alignItems: "flex-end", gap: 5, paddingTop: 12 }}>
            <T size={12} lh={16} ls={0} weight={400} color={th.t4} style={TNUM}>
              {e.day === 0 ? e.time : e.whenShort}
            </T>
            {e.fav && <Icon name="star" size={11} color={th.t4} />}
          </View>
        </View>
      </View>
    </SwipeRow>
  );
});

/** Grid card (`.mgc`, mockup 24): image 104 high r12 (or a quiet type placeholder), title 13 and time 12 under it. */
export function LibCard({ e, selected, onPress, onLongPress }: { e: Entry; selected: boolean; onPress: () => void; onLongPress: () => void }) {
  const th = useTheme();
  const own = !!e.img && !(typeof e.img === "object" && e.img !== null && "pack" in e.img);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={e.title} accessibilityState={{ selected }} onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => ({ flex: 1, minWidth: 0, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={{ height: 104, borderRadius: 12, overflow: "hidden", backgroundColor: th.name === "dark" ? th.lum3 : th.lum2, alignItems: "center", justifyContent: "center", boxShadow: selected ? `0 0 0 2px ${th.accent}` : undefined } as ViewStyle}>
        {own ? <Photo source={e.img} /> : <Icon name={entryIcon(e)} size={18} color={th.t3} />}
        {selected && (
          <View style={{ position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: th.accentFill }}>
            <Icon name="check" size={12} strokeWidth={3} color={th.onAccent} />
          </View>
        )}
      </View>
      <T size={13} lh={18} ls={0} weight={500} numberOfLines={1} style={{ marginTop: 7 }}>
        {e.title}
      </T>
      <T size={12} lh={16} ls={0} weight={400} numberOfLines={1} color={th.t3} style={[{ marginTop: 1 }, TNUM]}>
        {e.day === 0 ? `${t("Today")} ${e.time}` : e.whenShort}
      </T>
    </Pressable>
  );
}

/**
 * Timeline row (mockup 21, mobile): the time in a fixed column, a hairline rail with a ring dot, then the type icon,
 * title and two quiet lines. No card, no image: the order of the day carries the view.
 */
export function TimeRow({ e, selected, first, last, onPress, onLongPress }: { e: Entry; selected: boolean; first: boolean; last: boolean; onPress: () => void; onLongPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={e.title} accessibilityState={{ selected }} onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => ({ flexDirection: "row", paddingHorizontal: 20, backgroundColor: selected ? th.accentSoft : pressed ? alpha(th.t1, 0.05) : "transparent" })}>
      <T size={12} lh={16} ls={0} weight={400} color={th.t4} style={[{ width: 44, paddingTop: 13 }, TNUM]}>
        {e.day === 0 ? e.time : e.whenShort}
      </T>
      <View style={{ width: 22, alignItems: "center" }}>
        <View style={{ position: "absolute", top: first ? 16 : 0, bottom: last ? undefined : 0, height: last ? 16 : undefined, width: 1, backgroundColor: th.hairStrong }} />
        <View style={{ marginTop: 13, width: 9, height: 9, borderRadius: 5, borderWidth: 1.6, borderColor: selected ? th.accent : th.t3, backgroundColor: th.lum1 }} />
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingTop: 9, paddingBottom: 14, paddingLeft: 8, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Icon name={entryIcon(e)} size={14} color={th.t3} />
          <T size={15} lh={20} ls={0} weight={500} numberOfLines={1} style={{ flex: 1 }}>
            {e.title}
          </T>
        </View>
        {!!e.tldr?.trim() && (
          <T size={12.5} lh={17} ls={0} weight={400} numberOfLines={2} color={th.t3}>
            {e.tldr.trim()}
          </T>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          {!!e.tag && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: th.tags[tagTone(e.tag)]?.dot ?? th.t3 }} />}
          <T size={12} lh={16} ls={0} weight={400} numberOfLines={1} color={th.t4}>
            {e.tag ? `${e.tag.replace(/^#/, "")} · ${e.type}` : e.type}
          </T>
        </View>
      </View>
    </Pressable>
  );
}

/** Today's long date for a page eyebrow ("Donnerstag, 26. November"). */
export const longDate = (d: Date = new Date()) => d.toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long" });
