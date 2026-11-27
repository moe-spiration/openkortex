import { t } from "../../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, Platform, Pressable, ScrollView, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { alpha } from "../../theme/color";
import { FONT, RUHE_RADIUS, RUHE_SPACE, RUHE_TYPE, ruheWeight, type RuheTypeStep } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { tick } from "../../lib/haptics";
import { Icon, type IconName } from "../Icon";
import { useMotion } from "./motion";
import { GestureCtx, useGesturePlay } from "./gestures";
import { Pictogram, type PictogramKind, type PictogramSize } from "./Pictogram";

/*
 * Ruhe primitives for Android (android-richtlinien.md section 18). They are Ruhe only (no look branch inside):
 * screens pick `ruhe ? <ScreenRuhe/> : <Screen/>` at their entry. Every number comes from the guideline via
 * RUHE_SPACE / RUHE_RADIUS / RUHE_TYPE (src/theme/tokens.ts); screens should not invent other values.
 *
 * Margins: text, titles, section heads and rows sit 20 from the edge, surfaces (cards, segments, chip rows,
 * groups, button rows) 16. The primitives carry their own margins, so use them in a flush scroll area
 * (`<ScreenScroll flush>`).
 */

const { page: PAGE, surface: SURF } = RUHE_SPACE;

/* ------------------------------------------------------------------ text */

const familyOf = (w: number): string => (w >= 700 ? FONT.sans700 : w >= 600 ? FONT.sans600 : w >= 500 ? FONT.sans500 : FONT.sans400);

/** Font-scale caps (section 17): titles 1.15, navigation, chips and counters 1.3. */
const MAX_SCALE: Partial<Record<RuheTypeStep, number>> = { title: 1.15, titleDetail: 1.15, tabLabel: 1.3, chip: 1.3, meta: 1.3, micro: 1.3 };

export interface RTextProps extends TextProps {
  /** Type step of the guideline (section 3). */
  step?: RuheTypeStep;
  color?: string;
  /** Weight override (e.g. 500 for the noun in a log line, 400 for task rows). */
  weight?: 400 | 500 | 600 | 700;
  /** Tabular figures for numbers, times and counters. */
  tnum?: boolean;
  align?: TextStyle["textAlign"];
}

/** Ruhe text: Geist in one of the guideline steps, sentence case, letter spacing only on titles. */
export function RText({ step = "body", color, weight, tnum, align, style, maxFontSizeMultiplier, children, ...rest }: RTextProps) {
  const th = useTheme();
  const s = RUHE_TYPE[step];
  const w = ruheWeight(weight ?? s.weight, s.size);
  return (
    <Text
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_SCALE[step]}
      {...rest}
      style={[
        { fontFamily: familyOf(w), fontSize: s.size, lineHeight: s.lh, letterSpacing: s.ls * s.size, color: color ?? th.t1, textAlign: align },
        tnum ? { fontVariant: ["tabular-nums"] } : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------ press feedback */

/**
 * Pressable with the Ruhe press: scale .97 in 120 ms (d1, eo) and back. No opacity dim (it dulls the accent).
 * `flat` rows use the full-width alpha(t1, .05) wash instead of the scale.
 */
export function RPress({
  onPress,
  onLongPress,
  disabled,
  style,
  flat,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
  children,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  flat?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "tab" | "checkbox" | "switch" | "menuitem";
  accessibilityState?: { selected?: boolean; checked?: boolean; disabled?: boolean };
  hitSlop?: number;
  children?: ReactNode;
}) {
  const th = useTheme();
  const m = useMotion();
  const s = useSharedValue(1);
  const [down, setDown] = useState(false);
  const [play, fire] = useGesturePlay();
  const dur = m.d1;
  const ease = m.eo;
  const scaled = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <APressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, ...accessibilityState }}
      disabled={disabled}
      onPress={
        onPress
          ? () => {
              fire();
              onPress();
            }
          : undefined
      }
      onLongPress={onLongPress}
      hitSlop={hitSlop}
      onPressIn={() => {
        if (flat) return setDown(true);
        if (!m.reduced) s.value = withTiming(0.97, { duration: dur, easing: ease });
      }}
      onPressOut={() => {
        if (flat) return setDown(false);
        s.value = withTiming(1, { duration: dur, easing: ease });
      }}
      style={[style, flat && down ? { backgroundColor: alpha(th.t1, 0.05) } : null, disabled ? { opacity: 0.5 } : null, flat ? null : scaled]}
    >
      <GestureCtx.Provider value={play}>{children}</GestureCtx.Provider>
    </APressable>
  );
}

const APressable = Animated.createAnimatedComponent(Pressable);

/* ------------------------------------------------------------------ buttons */

export type RButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

/**
 * Buttons (section 11). lg 44 / r12 / 15-500, sm 38 / r10 / 14-500. Primary = accent fill with onAccent text,
 * secondary = lum3 + t1, ghost = transparent + t2 (r8), destructive = lum3 + crit (never filled red).
 * Exactly one primary per screen state; pairs: primary left `grow`, secondary right by content, gap 8.
 */
export function RButton({
  variant = "secondary",
  size = "lg",
  icon,
  label,
  onPress,
  grow,
  disabled,
  accessibilityLabel,
  style,
}: {
  variant?: RButtonVariant;
  size?: "lg" | "sm";
  icon?: IconName;
  label?: string;
  onPress?: () => void;
  grow?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const th = useTheme();
  const lg = size === "lg";
  const bg = variant === "primary" ? th.accentFill : variant === "ghost" ? "transparent" : th.lum3;
  const fg = variant === "primary" ? th.onAccent : variant === "ghost" ? th.t2 : variant === "destructive" ? th.crit : th.t1;
  const radius = variant === "ghost" ? RUHE_RADIUS.r8 : lg ? RUHE_RADIUS.r12 : RUHE_RADIUS.r10;
  return (
    <RPress
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        {
          height: lg ? 44 : 38,
          minWidth: 44,
          paddingHorizontal: lg ? 18 : 14,
          borderRadius: radius,
          backgroundColor: bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        },
        grow ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : null,
        style,
      ]}
    >
      {icon && <Icon name={icon} size={lg ? 18 : 16} color={fg} />}
      {!!label && (
        <RText step={lg ? "button" : "buttonSm"} color={fg} numberOfLines={1}>
          {label}
        </RText>
      )}
    </RPress>
  );
}

/** Button pair / row on the surface margin (16), gap 8. */
export function RButtonRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: SURF }, style]}>{children}</View>;
}

/** Icon button 40 round (header actions): icon 18 t2, active accentSoft + accentInk. Touch target 44 through hitSlop. */
export function RIconButton({ icon, label, onPress, on, color, size = 40 }: { icon: IconName; label: string; onPress: () => void; on?: boolean; color?: string; size?: number }) {
  const th = useTheme();
  const [play, fire] = useGesturePlay();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!on }}
      onPress={() => {
        fire();
        onPress();
      }}
      hitSlop={Math.max(0, (44 - size) / 2)}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: on ? th.accentSoft : pressed ? alpha(th.t1, 0.05) : "transparent" })}
    >
      <Icon name={icon} size={18} play={play} color={on ? th.accentInk : (color ?? th.t2)} />
    </Pressable>
  );
}

/** Round avatar with initials (30 in the title row of Heute, 52 on a dossier). */
export function RAvatar({ initials, size = 30, onPress, label }: { initials: string; size?: number; onPress?: () => void; label?: string }) {
  const th = useTheme();
  const big = size >= 44;
  const face = (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: th.lum3 }}>
      <RText step={big ? "titleCard" : "label"} weight={500} color={th.t2} style={big ? { letterSpacing: 0 } : null}>
        {initials}
      </RText>
    </View>
  );
  if (!onPress) return face;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      {face}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ header system (section 8) */

export interface RAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  on?: boolean;
}

/**
 * Ortsleiste (pattern A, large-title page): optional eyebrow (date) 2 above the title, title 30/700/-0.03em on the
 * left, at most two icon actions (40 round) and an optional trailing node (avatar) on the right. Block padding
 * 6 / 20 / 10. No strip, no blur, no line: it scrolls with the content. The title never wraps next to actions
 * (one line, shrinks); segments belong in the Sichtleiste below, never beside the title.
 */
export function RuheLocBar({ eyebrow, title, actions, trailing, style }: { eyebrow?: string; title: string; actions?: RAction[]; trailing?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  const right = (actions?.length ?? 0) > 0 || !!trailing;
  return (
    <View style={[{ paddingTop: RUHE_SPACE.headTop, paddingHorizontal: PAGE, paddingBottom: RUHE_SPACE.headBottom }, style]}>
      {!!eyebrow && (
        <RText step="eyebrow" color={th.t3} numberOfLines={1} style={{ marginBottom: 2 }}>
          {eyebrow}
        </RText>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40 }}>
        <RText step="title" accessibilityRole="header" numberOfLines={right ? 1 : 2} style={{ flex: 1, minWidth: 0, flexShrink: 1 }}>
          {title}
        </RText>
        {right && (
          <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, marginRight: -10 }}>
            {actions?.slice(0, 2).map((a) => <RIconButton key={a.label} icon={a.icon} label={a.label} on={a.on} onPress={a.onPress} />)}
            {trailing}
          </View>
        )}
      </View>
    </View>
  );
}

/** Alias in the guideline's naming (section 18 `PageHeader`). */
export const PageHeader = RuheLocBar;

/**
 * Sichtleiste: the view row under the Ortsleiste. Either a segment / lens control (margin 2 16 12) or a chip row
 * (padding 2 16 6), never both in one bar.
 */
export function RuheViewBar<K extends string>(props: { segment: RSegmentProps<K>; chips?: never } | { chips: RChipItem[]; segment?: never }) {
  if (props.segment) return <RSegment {...props.segment} style={{ marginTop: 2, marginHorizontal: SURF, marginBottom: 12 }} />;
  return <RChipRow items={props.chips ?? []} style={{ paddingTop: 2, paddingBottom: 6 }} />;
}

/**
 * Detail page head (pattern B): back link (chevron 18 + 15 in accentInk, row 36, padding 4 14 0), then an optional
 * status line (`kind` step, e.g. StatusRing + "Wartet auf Dich"), the detail title 24/700 and a subtitle.
 * With `avatar` (dossier): avatar 52 with initials next to name 22/700 and the subtitle. Android back is wired.
 */
export function DetailHeader({
  backLabel,
  onBack,
  status,
  title,
  subtitle,
  avatar,
  actions,
  hardwareBack = true,
}: {
  backLabel: string;
  onBack: () => void;
  status?: ReactNode;
  title: string;
  subtitle?: string;
  avatar?: string;
  actions?: RAction[];
  /** Also close on the Android back gesture (default on). */
  hardwareBack?: boolean;
}) {
  const th = useTheme();
  useEffect(() => {
    if (!hardwareBack || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [hardwareBack, onBack]);
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", height: 36, paddingTop: 4, paddingHorizontal: 14 }}>
        <Pressable accessibilityRole="link" accessibilityLabel={t("Back to {label}", { label: backLabel })} onPress={onBack} hitSlop={8} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1 })}>
          <Icon name="chevLeft" size={18} color={th.accentInk} />
          <RText step="body" color={th.accentInk} numberOfLines={1}>
            {backLabel}
          </RText>
        </Pressable>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", marginRight: -4 }}>
          {actions?.slice(0, 2).map((a) => <RIconButton key={a.label} icon={a.icon} label={a.label} on={a.on} onPress={a.onPress} />)}
        </View>
      </View>
      <View style={{ paddingTop: RUHE_SPACE.headTop, paddingHorizontal: PAGE, paddingBottom: RUHE_SPACE.headBottom }}>
        {avatar ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <RAvatar initials={avatar} size={52} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <RText step="titleDetail" accessibilityRole="header" numberOfLines={2} style={{ fontSize: 22, lineHeight: 28, letterSpacing: -0.025 * 22 }}>
                {title}
              </RText>
              {!!subtitle && (
                <RText step="eyebrow" color={th.t3} numberOfLines={1}>
                  {subtitle}
                </RText>
              )}
            </View>
          </View>
        ) : (
          <>
            {status}
            <RText step="titleDetail" accessibilityRole="header" numberOfLines={3} style={status ? { marginTop: 2 } : null}>
              {title}
            </RText>
            {!!subtitle && (
              <RText step="eyebrow" color={th.t3} numberOfLines={2} style={{ marginTop: 2 }}>
                {subtitle}
              </RText>
            )}
          </>
        )}
      </View>
    </View>
  );
}

/** Status line of a detail head or card: ring/icon 15 plus text in the `kind` step (accentInk by default). */
export function KindLine({ icon, ring, text, color }: { icon?: IconName; ring?: StatusRingState; text: string; color?: string }) {
  const th = useTheme();
  const c = color ?? th.accentInk;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {ring ? <StatusRing state={ring} /> : icon ? <Icon name={icon} size={14} color={c} /> : null}
      <RText step="kind" color={c} numberOfLines={1} tnum>
        {text}
      </RText>
    </View>
  );
}

/* ------------------------------------------------------------------ segment, chips (section 12) */

export interface RSegmentProps<K extends string> {
  items: { key: K; label: string; icon?: IconName }[];
  value: K;
  onChange: (k: K) => void;
  /** Accessibility name of the tab list. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Segment / lens control (`.mlens`): track lum2 (dark) / lum3 (light), padding 3, radius 12, gap 2. Items 32 high,
 * radius 9, icon 14 + text 13; the active pill (lum4 dark, lum1 + soft shadow light) glides in 180 ms (eo).
 * Two-way switches (Tag/Woche, Aufträge/Fragen) use it at full width under the title.
 */
export function RSegment<K extends string>({ items, value, onChange, label, style }: RSegmentProps<K>) {
  const th = useTheme();
  const m = useMotion();
  const dark = th.name === "dark";
  const [w, setW] = useState(0);
  const idx = Math.max(0, items.findIndex((i) => i.key === value));
  const n = Math.max(1, items.length);
  const itemW = w > 0 ? (w - 6 - 2 * (n - 1)) / n : 0;
  const x = useSharedValue(0);
  const dur = m.d2;
  const ease = m.eo;
  useEffect(() => {
    const to = idx * (itemW + 2);
    x.value = m.reduced || itemW === 0 ? to : withTiming(to, { duration: dur, easing: ease });
  }, [idx, itemW, m.reduced, dur, ease, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ flexDirection: "row", gap: 2, padding: 3, borderRadius: RUHE_RADIUS.r12, backgroundColor: dark ? th.lum2 : th.lum3 }, style]}
    >
      {itemW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", left: 3, top: 3, bottom: 3, width: itemW, borderRadius: 9, backgroundColor: dark ? th.lum4 : th.lum1 },
            dark ? null : ({ boxShadow: "0 1px 2px rgba(40, 36, 30, 0.12)" } as ViewStyle),
            pill,
          ]}
        />
      )}
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityLabel={it.label}
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 6, bottom: 6 }}
            onPress={() => {
              if (on) return;
              tick();
              onChange(it.key);
            }}
            style={{ flex: 1, height: 32, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 9 }}
          >
            {it.icon && <Icon name={it.icon} size={14} color={on ? th.t1 : th.t3} />}
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ fontFamily: on ? FONT.sans500 : FONT.sans400, fontSize: 13, lineHeight: 18, color: on ? th.t1 : th.t3 }}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface RChipItem {
  key: string;
  label: string;
  /** Counter inside the label ("Inbox 2"), t4 or inverted. */
  count?: number;
  on: boolean;
  onPress: () => void;
}

/** Filter chip (`.mseg span`): 32 high, padding 0 13, radius 16, 13.5. Inactive lum2 / lum3 + t3, active inverted (t1 fill, lum1 text, 500). */
export function RChip({ label, count, on, onPress }: Omit<RChipItem, "key">) {
  const th = useTheme();
  const dark = th.name === "dark";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={count != null ? `${label} ${count}` : label}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={() => {
        if (!on) tick();
        onPress();
      }}
      style={({ pressed }) => ({ height: 32, paddingHorizontal: 13, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: on ? th.t1 : pressed ? th.lum4 : dark ? th.lum2 : th.lum3 })}
    >
      <RText step="chip" color={on ? th.lum1 : th.t3} numberOfLines={1}>
        {label}
      </RText>
      {count != null && (
        <RText step="chip" tnum color={on ? alpha(th.lum1, 0.6) : th.t4}>
          {String(count)}
        </RText>
      )}
    </Pressable>
  );
}

/** Horizontally scrolling chip row on the surface margin (16), gap 4. One active chip. */
export function RChipRow({ items, style }: { items: RChipItem[]; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={{ paddingHorizontal: SURF, gap: RUHE_SPACE.chipGap }}>
      {items.map((c) => (
        <RChip key={c.key} label={c.label} count={c.count} on={c.on} onPress={c.onPress} />
      ))}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ list (section 7) */

/** Group head (`.mlab`): 13/600 t2 plus counter 400 t4, gap 8; 18 before, 6 after. */
export function GroupHead({ label, count, right, style }: { label: string; count?: number | string; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: RUHE_SPACE.labelTop, paddingHorizontal: PAGE, paddingBottom: RUHE_SPACE.labelBottom }, style]}>
      <RText step="label" color={th.t2} accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </RText>
      {count != null && count !== "" && (
        <RText step="label" weight={400} tnum color={th.t4}>
          {String(count)}
        </RText>
      )}
      {right && <View style={{ marginLeft: "auto" }}>{right}</View>}
    </View>
  );
}

/** Same as GroupHead (the brief's name for section heads). */
export const RSection = GroupHead;

export interface RRowProps {
  /** Monochrome lead icon 18 (t3). Replaced by a check in accent while selected. */
  icon?: IconName;
  iconColor?: string;
  /** Custom lead (task circle, avatar); wins over `icon`. */
  lead?: ReactNode;
  title: string;
  /** 500 for entries (default), 400 for tasks and log rows. */
  titleWeight?: 400 | 500;
  titleColor?: string;
  sub?: string;
  subColor?: string;
  /** Time or date on the right (meta, tabular). */
  meta?: string;
  /** Counter + chevron on the right (vault folders). */
  count?: number;
  chevron?: boolean;
  /** Any node on the right (checkbox, toggle). */
  trailing?: ReactNode;
  /** First row of a group. Kept for callers; rows carry no hairline any more (principle 2: rhythm, not lines). */
  first?: boolean;
  selected?: boolean;
  /** 62 high (two-line entries, meta aligned to the top). */
  tall?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
}

/**
 * List row (`.mrow`): 52 high (62 tall), padding 0 20, lead icon, gap 12, text column, meta on the right. No
 * hairline between rows: the fixed row height alone carries the rhythm (principle 2). No fill, no tile, no thumbnail. Pressed: alpha(t1, .05) over the full width; selected: accentSoft + a check.
 */
export function RRow({ icon, iconColor, lead, title, titleWeight = 500, titleColor, sub, subColor, meta, count, chevron, trailing, selected, tall, disabled, onPress, onLongPress, accessibilityLabel }: RRowProps) {
  const th = useTheme();
  const h = tall ? RUHE_SPACE.rowTall : RUHE_SPACE.row;
  const right = meta != null || count != null || chevron || trailing;
  const pressable = !!onPress || !!onLongPress;
  const [play, fire] = useGesturePlay();
  return (
    <View style={[{ height: h }, selected ? { backgroundColor: th.accentSoft } : null, disabled ? { opacity: 0.5 } : null]}>
      {/* The press surface lies under the content, so an interactive lead or trailing (check, button) is no nested button. */}
      {pressable && (
        <RPress
          flat
          onPress={
            onPress
              ? () => {
                  fire();
                  onPress();
                }
              : undefined
          }
          onLongPress={onLongPress}
          disabled={disabled}
          accessibilityLabel={accessibilityLabel ?? title}
          accessibilityState={{ selected: !!selected }}
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        />
      )}
      <View pointerEvents="box-none" style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: RUHE_SPACE.iconGap, paddingHorizontal: PAGE }}>
        {selected ? <Icon name="check" size={18} color={th.accentInk} /> : (lead ?? (icon ? <Icon name={icon} size={18} play={play} color={iconColor ?? th.t3} /> : null))}
        <View pointerEvents="box-none" style={{ flex: 1, minWidth: 0, alignSelf: "stretch", flexDirection: "row", alignItems: tall ? "flex-start" : "center", gap: 12 }}>
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
            <RText step="rowTitle" weight={titleWeight} color={titleColor ?? th.t1} numberOfLines={1}>
              {title}
            </RText>
            {!!sub && (
              <RText step="rowSub" color={subColor ?? th.t3} numberOfLines={1} style={{ marginTop: 1 }}>
                {sub}
              </RText>
            )}
          </View>
          {right && (
            <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, paddingTop: tall ? 12 : 0 }}>
              {meta != null && (
                <RText step="meta" tnum color={th.t4} pointerEvents="none">
                  {meta}
                </RText>
              )}
              {count != null && (
                <RText step="meta" tnum color={th.t4} pointerEvents="none">
                  {String(count)}
                </RText>
              )}
              {chevron && <Icon name="chev" size={15} color={th.t4} />}
              {trailing}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/** A plain list container (no box). Rows mark their own `first`. */
export function RList({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{children}</View>;
}

/**
 * Outlined group (confirm list, properties, settings groups): radius 16, ring hairStrong, no fill, hairlines between
 * rows (RGroupRow `first` drops the top one). Surface margin 16.
 */
export function RGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return <View style={[{ marginHorizontal: SURF, borderRadius: RUHE_RADIUS.r16, overflow: "hidden", boxShadow: `inset 0 0 0 1px ${th.hairStrong}` } as ViewStyle, style]}>{children}</View>;
}

/** A row inside RGroup: min 48, padding 0 14, icon 18, text 15, trailing (check, toggle, value). */
export function RGroupRow({ icon, iconColor, label, sub, value, trailing, first, danger, onPress }: { icon?: IconName; iconColor?: string; label: string; sub?: string; value?: string; trailing?: ReactNode; first?: boolean; danger?: boolean; onPress?: () => void }) {
  const th = useTheme();
  const body = (
    <View style={[{ minHeight: RUHE_SPACE.menuRow, paddingVertical: 8, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 }, first ? null : { borderTopWidth: 1, borderTopColor: th.hair }]}>
      {icon && <Icon name={icon} size={18} color={danger ? th.crit : (iconColor ?? th.t2)} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <RText step="body" weight={400} color={danger ? th.crit : th.t1} numberOfLines={2}>
          {label}
        </RText>
        {!!sub && (
          <RText step="rowSub" color={th.t3} numberOfLines={2}>
            {sub}
          </RText>
        )}
      </View>
      {!!value && (
        <RText step="rowSub" color={th.t3} numberOfLines={1} style={{ maxWidth: "45%" }}>
          {value}
        </RText>
      )}
      {trailing}
    </View>
  );
  if (!onPress) return body;
  return (
    <RPress flat onPress={onPress} accessibilityLabel={label}>
      {body}
    </RPress>
  );
}

/** Menu row in a sheet: 48 high, icon 18 t2, text 15 t1, destructive in crit. */
export function RMenuRow({ icon, label, danger, onPress, disabled }: { icon: IconName; label: string; danger?: boolean; onPress: () => void; disabled?: boolean }) {
  const th = useTheme();
  return (
    <RPress flat onPress={onPress} disabled={disabled} accessibilityRole="menuitem" accessibilityLabel={label} style={{ height: RUHE_SPACE.menuRow, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, borderRadius: RUHE_RADIUS.r12 }}>
      <Icon name={icon} size={18} color={danger ? th.crit : th.t2} />
      <RText step="body" color={danger ? th.crit : th.t1} numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </RText>
    </RPress>
  );
}

/** Hairline between groups of a menu or list (1 dp `hair`). */
export function RHair({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return <View style={[{ height: 1, marginLeft: inset, backgroundColor: th.hair }, style]} />;
}

/* ------------------------------------------------------------------ card (sections 2, 4) */

/**
 * The one card of the look (agent card on Heute, `.mcard`): margin 4 16 0, radius 16, lum2 (dark) / lum1 + ring
 * (light), optional image 150 on top, body padding 14 16 16: kind line, title 17/600, meta 12.5 t3, actions.
 * Never a card in a card; never stacked surfaces inside.
 */
export function RCard({ image, kind, title, meta, actions, onPress, style, children }: { image?: ReactNode; kind?: ReactNode; title?: string; meta?: string; actions?: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const th = useTheme();
  const dark = th.name === "dark";
  const shell: ViewStyle = { marginTop: 4, marginHorizontal: SURF, borderRadius: RUHE_RADIUS.r16, overflow: "hidden", backgroundColor: dark ? th.lum2 : th.lum1, ...(dark ? null : ({ boxShadow: `inset 0 0 0 1px ${th.hairStrong}` } as ViewStyle)) };
  // Image and text open the card; the kind line (it may hold a link) and the actions sit outside the press areas.
  const press = (node: ReactNode) =>
    onPress ? (
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
        {node}
      </Pressable>
    ) : (
      node
    );
  return (
    <View style={[shell, style]}>
      {image && press(<View style={{ height: 150, overflow: "hidden" }}>{image}</View>)}
      <View style={{ paddingTop: RUHE_SPACE.cardTop, paddingHorizontal: RUHE_SPACE.cardSide, paddingBottom: RUHE_SPACE.cardBottom }}>
        {kind}
        {press(
          <View>
            {!!title && (
              <RText step="titleCard" numberOfLines={3} style={kind ? { marginTop: 8 } : null}>
                {title}
              </RText>
            )}
            {!!meta && (
              <RText step="rowSub" color={th.t3} numberOfLines={2} tnum style={{ marginTop: 6 }}>
                {meta}
              </RText>
            )}
          </View>,
        )}
        {children}
        {actions && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 }}>{actions}</View>}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ small things (section 12) */

/** Metadata pill (type, status): 20 high, padding 0 7, radius 6, 11.5 t2 on lum2. */
export function RPill({ children }: { children: string }) {
  const th = useTheme();
  return (
    <View style={{ height: 20, paddingHorizontal: 7, borderRadius: RUHE_RADIUS.r6, justifyContent: "center", alignSelf: "flex-start", backgroundColor: th.lum2 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: FONT.sans400, fontSize: 11.5, lineHeight: 14, color: th.t2 }} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/** Tag: a 6 dp dot in the tag colour plus 12.5 t3 text. No pill, no tint. */
export function TagDot({ color, label }: { color: string; label?: string }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      {!!label && (
        <RText step="rowSub" color={th.t3} numberOfLines={1}>
          {label}
        </RText>
      )}
    </View>
  );
}

/** Tag colour of a tag name: OKLCH 0.70 / 0.11 with a stable hue per tag (dark), 0.6 in light. */
export function tagHue(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 360;
  return h;
}

export type StatusRingState = "waiting" | "running" | "done" | "error" | "progress";

/**
 * Agent status ring 15 dp: track lum4 stroke 2, arc acc; waiting = full ring, running = turning arc (700 ms linear,
 * still when motion is reduced), done = check circle in ok, error = ring in crit, progress = share of the ring.
 */
export function StatusRing({ state, progress = 0, size = 15 }: { state: StatusRingState; progress?: number; size?: number }) {
  const th = useTheme();
  const m = useMotion();
  const rot = useSharedValue(0);
  const spin = state === "running" && !m.reduced;
  useEffect(() => {
    if (!spin) {
      cancelAnimation(rot);
      rot.value = 0;
      return;
    }
    rot.value = withRepeat(withTiming(360, { duration: 700, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rot);
  }, [spin, rot]);
  const turning = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  if (state === "done") return <Icon name="checkCircle" size={size} color={th.ok} />;
  const r = 6;
  const c = 2 * Math.PI * r;
  const share = state === "waiting" ? 1 : state === "running" ? 0.3 : state === "error" ? 1 : Math.max(0, Math.min(1, progress));
  const col = state === "error" ? th.crit : th.accent;
  return (
    <Animated.View style={[{ width: size, height: size }, turning]}>
      <Svg width={size} height={size} viewBox="0 0 16 16">
        <Circle cx={8} cy={8} r={r} fill="none" stroke={th.lum4} strokeWidth={2} />
        {share > 0 && <Circle cx={8} cy={8} r={r} fill="none" stroke={col} strokeWidth={2} strokeDasharray={`${c * share} ${c}`} strokeLinecap="round" transform="rotate(-90 8 8)" />}
      </Svg>
    </Animated.View>
  );
}

/** Confirm checkbox: square 20, radius 6, on = accent + white check (12, stroke 3), off = ring 1.5 t4. */
export function RCheck({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      hitSlop={12}
      onPress={() => {
        tick();
        onPress();
      }}
    >
      <View style={[{ width: 20, height: 20, borderRadius: RUHE_RADIUS.r6, alignItems: "center", justifyContent: "center", backgroundColor: on ? th.accent : "transparent" }, on ? null : ({ boxShadow: `inset 0 0 0 1.5px ${th.t4}` } as ViewStyle)]}>
        {on && <CheckMark size={12} color="#FFFFFF" />}
      </View>
    </Pressable>
  );
}

function CheckMark({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Path d="M2.5 6.2l2.3 2.3L9.6 3.6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Task circle 20 (line 1.4 t4); done = accent fill + white check. The row title turns t3 (caller).
 * Checking it off (motion-demos.html "Aufgabe abhaken"): the circle fills with a small spring (scale .78 to 1 in
 * 260 ms), then the check draws from the left (180 ms eo, 60 ms later). Only on the change, never on mount.
 */
export function RTaskCheck({ done, onPress, label }: { done: boolean; onPress: () => void; label: string }) {
  const th = useTheme();
  const m = useMotion();
  const pop = useSharedValue(1);
  const draw = useSharedValue(1);
  const was = useRef(done);
  const d3 = m.d3;
  const d2 = m.d2;
  const spring = m.spring;
  const eo = m.eo;
  const off = m.reduced;
  useEffect(() => {
    const turnedOn = done && !was.current;
    was.current = done;
    if (!turnedOn || off) return;
    pop.value = 0.78;
    pop.value = withTiming(1, { duration: d3, easing: spring });
    draw.value = 0;
    draw.value = withDelay(60, withTiming(1, { duration: d2, easing: eo }));
  }, [done, off, d3, d2, spring, eo, pop, draw]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const drawStyle = useAnimatedStyle(() => ({ width: 12 * draw.value }));
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: done }} hitSlop={12} onPress={onPress}>
      <Animated.View style={[{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: done ? th.accent : "transparent" }, done ? null : ({ boxShadow: `inset 0 0 0 1.4px ${th.t4}` } as ViewStyle), popStyle]}>
        {done && (
          <View style={{ width: 12, height: 12 }}>
            <Animated.View style={[{ height: 12, overflow: "hidden" }, drawStyle]}>
              <CheckMark size={12} color="#FFFFFF" />
            </Animated.View>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

/**
 * A row that leaves its list when checked (Heute "Due today", Aufgaben "All open") stays for the check animation
 * (about 420 ms; immediately with Bewegung "Aus"), then the change runs. `ticked(id)` shows it checked meanwhile.
 */
export function useTickLater(): { ticked: (id: string) => boolean; tickLater: (id: string, run: () => void) => void } {
  const m = useMotion();
  const [on, setOn] = useState<Record<string, true>>({});
  const wait = m.reduced ? 0 : m.calm ? 300 : 420;
  return {
    ticked: (id) => !!on[id],
    tickLater: (id, run) => {
      if (on[id]) return;
      if (!wait) return run();
      tick();
      setOn((x) => ({ ...x, [id]: true }));
      setTimeout(() => {
        run();
        setOn((x) => {
          const rest = { ...x };
          delete rest[id];
          return rest;
        });
      }, wait);
    },
  };
}

/** Toggle 40 x 24, radius 12, white knob 20; on = accent, off = lum3; the knob moves in 180 ms (spring curve). */
export function RToggle({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const th = useTheme();
  const m = useMotion();
  const x = useSharedValue(on ? 16 : 0);
  const dur = m.d2;
  const ease = m.spring;
  useEffect(() => {
    x.value = withTiming(on ? 16 : 0, { duration: dur, easing: ease });
  }, [on, dur, ease, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      hitSlop={10}
      onPress={() => {
        tick();
        onPress();
      }}
    >
      <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: on ? th.accent : th.lum3 }}>
        <Animated.View style={[{ position: "absolute", top: 2, left: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFFFFF" }, knob]} />
      </View>
    </Pressable>
  );
}

/** Progress bar 3 dp: track lum4, fill t2 (accent only when it is the user's own task, e.g. recording). */
export function RProgress({ pct, accent, style }: { pct: number; accent?: boolean; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return (
    <View style={[{ height: 3, borderRadius: 2, backgroundColor: th.lum4, overflow: "hidden" }, style]}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", backgroundColor: accent ? th.accent : th.t2 }} />
    </View>
  );
}

/* ------------------------------------------------------------------ empty, loading, sync (section 16) */

/**
 * Empty state: centred in the upper third, icon 28 t4, title 15/500 t1, help 12.5 t3 (max two lines, 280 wide),
 * optional ghost action. No box, no emoji, no pastel. Say what shows up here and how it gets here.
 * With `pic` the icon gives way to the animated pictogram of the Ruhe concept (Linear-like: the drawing, one title
 * line, one text line), lg for a whole empty view, md for a section, sm inline under a group head. It rises in like
 * a view (260 ms, 6 dp); Bewegung "Aus" shows it still.
 */
export function EmptyState({
  icon,
  pic,
  size = "lg",
  idle,
  title,
  help,
  action,
}: {
  icon: IconName;
  pic?: PictogramKind;
  size?: PictogramSize;
  /** Agent pictogram without a job: slower, nothing connects. */
  idle?: boolean;
  title: string;
  help?: string;
  action?: { label: string; onPress: () => void };
}) {
  const th = useTheme();
  const m = useMotion();
  const o = useSharedValue(m.reduced ? 1 : 0);
  const y = useSharedValue(m.offset(6));
  const dur = m.d3;
  const ease = m.eo;
  useEffect(() => {
    o.value = withTiming(1, { duration: dur, easing: ease });
    y.value = withTiming(0, { duration: dur, easing: ease });
  }, [o, y, dur, ease]);
  const rise = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  const top = !pic ? 56 : size === "sm" ? 6 : size === "md" ? 20 : 40;
  return (
    <Animated.View style={[{ alignItems: "center", paddingTop: top, paddingBottom: pic && size === "sm" ? 8 : 0, paddingHorizontal: PAGE, gap: 6 }, rise]}>
      {pic ? <Pictogram kind={pic} size={size} idle={idle} style={{ marginBottom: size === "sm" ? 2 : 8 }} /> : <Icon name={icon} size={28} color={th.t4} />}
      <RText step="rowTitle" align="center" style={{ marginTop: pic ? 0 : 6 }}>
        {title}
      </RText>
      {!!help && (
        <RText step="rowSub" color={th.t3} align="center" numberOfLines={3} style={{ maxWidth: 280 }}>
          {help}
        </RText>
      )}
      {action && <RButton variant="ghost" size="sm" label={action.label} onPress={action.onPress} style={{ marginTop: 4 }} />}
    </Animated.View>
  );
}

/** Loading rows: skeleton lines with a gentle pulse (opacity .5 to 1, 420 ms eio); still when motion is reduced. */
export function RSkeletonRows({ n = 5 }: { n?: number }) {
  const th = useTheme();
  const m = useMotion();
  const o = useSharedValue(1);
  const dur = m.d4;
  const ease = m.eio;
  useEffect(() => {
    if (m.reduced) {
      o.value = 0.75;
      return;
    }
    o.value = withRepeat(withTiming(0.5, { duration: dur, easing: ease }), -1, true);
    return () => cancelAnimation(o);
  }, [m.reduced, dur, ease, o]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View style={pulse} accessibilityLabel={t("Loading")}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ height: RUHE_SPACE.row, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: PAGE }}>
          <View style={{ width: 18, height: 18, borderRadius: RUHE_RADIUS.r6, backgroundColor: th.lum3 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 10, width: `${70 - ((i * 13) % 30)}%`, borderRadius: 5, backgroundColor: th.lum3 }} />
            <View style={{ height: 8, width: `${45 - ((i * 7) % 20)}%`, borderRadius: 4, backgroundColor: th.lum2 }} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

/** Sync / error line: icon 14 (ok or crit) plus 12.5 t3, never a red block. */
export function SyncLine({ text, error }: { text: string; error?: boolean }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: PAGE, paddingVertical: 4 }}>
      <Icon name={error ? "x" : "checkCircle"} size={14} color={error ? th.crit : th.ok} />
      <RText step="rowSub" color={th.t3} numberOfLines={1} tnum style={{ flex: 1 }}>
        {text}
      </RText>
    </View>
  );
}
