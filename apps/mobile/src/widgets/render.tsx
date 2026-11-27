import { FlexWidget, ListWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import type { ColorProp, TextWidgetStyle, WidgetRepresentation } from "react-native-android-widget";
import { t, tn, tx } from "../i18n";
import type { EntryKind } from "../data/mock";
import { alpha } from "../theme/color";
import { createTheme, type TagTone, type Theme, type ThemeName } from "../theme/tokens";
import { captureLink } from "../notify/plan";
import { ICONS, type IconName } from "../ui/iconShapes";
import { typeIconName } from "../ui/typeIcon";
import {
  CLICK,
  ENTRY_SOURCES,
  quickLink,
  tabLink,
  widgetDate,
  WIDGET_CAPTURE,
  WIDGET_CHECKIN,
  WIDGET_ENTRIES,
  type CheckinModel,
  type AppStyle,
  type EntryCard,
  type EntrySource,
  type TodayModel,
  type TodayRow,
  type WidgetSettings,
} from "./model";

/*
 * The home screen widgets as widget JSX (react-native-android-widget draws it natively). Colours come from
 * the app tokens; the per-widget settings add transparency and a fixed light or dark look. Lists are
 * ListWidget, so a large widget scrolls. Texts are read when a widget is drawn; the headless callers
 * restore the stored language first (src/i18n/device.ts).
 */

export interface Palette {
  bg: ColorProp;
  line: ColorProp;
  /** Cards and buttons on the widget. */
  surface: ColorProp;
  text: ColorProp;
  muted: ColorProp;
  accent: ColorProp;
  onAccent: ColorProp;
  accentSoft: ColorProp;
  crit: ColorProp;
  /** Text glow on a see-through widget, so text stays readable on any wallpaper. */
  glow: ColorProp | null;
  tone: (tone: TagTone) => { fg: ColorProp; bg: ColorProp };
}

const c = (v: string) => v as ColorProp;

export function paletteOf(th: Theme, opacity = 1): Palette {
  const glass = opacity < 0.6;
  // Ruhe: softer hairline and monochrome type icons (no coloured tiles), like the app in that look.
  const ruhe = th.look === "ruhe";
  return {
    bg: c(alpha(th.lum1, opacity)),
    line: c(opacity === 0 ? "rgba(0, 0, 0, 0)" : ruhe ? th.hair : th.hairStrong),
    // Cards keep some body on a glass widget: they carry the text.
    surface: c(alpha(th.lum3, glass ? Math.max(0.55, opacity + 0.25) : 1)),
    text: c(th.t1),
    muted: c(glass ? th.t2 : th.t3),
    accent: c(th.accentFill),
    onAccent: c(th.onAccent),
    accentSoft: c(alpha(th.accentFill, 0.16)),
    crit: c(th.crit),
    glow: glass ? c(alpha(th.lum1, 0.75)) : null,
    tone: ruhe ? () => ({ fg: c(th.t2), bg: c(alpha(th.t1, 0.07)) }) : (tone) => ({ fg: c(th.tags[tone].dot), bg: c(alpha(th.tags[tone].dot, 0.16)) }),
  };
}

/** Text style with the glow of a see-through widget. */
const ts = (p: Palette, style: TextWidgetStyle): TextWidgetStyle =>
  p.glow ? { ...style, textShadowColor: p.glow, textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } } : style;

function shapeSvg(name: IconName, color: string, stroke: number): string {
  const body = ICONS[name]
    .map((s) => (s.t === "p" ? `<path d="${s.d}"/>` : s.t === "c" ? `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>` : `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${s.rx ? ` rx="${s.rx}"` : ""}/>`))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** SvgWidget only knows hex; rgba(...) is turned into #RRGGBB plus stroke-opacity. */
function svgColor(color: ColorProp): string {
  const m = /^rgba\(([^)]+)\)$/.exec(color);
  if (!m) return color;
  const [r, g, b] = m[1]!.split(",").map((x) => Math.round(parseFloat(x)));
  return `#${[r, g, b].map((x) => (x ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

function Ico({ name, color, size = 18, stroke = 2 }: { name: IconName; color: ColorProp; size?: number; stroke?: number }) {
  return <SvgWidget svg={shapeSvg(name, svgColor(color), stroke)} style={{ width: size, height: size }} />;
}

// Lucide line icons of the in-app capture fan (pencil-line differs from the app set's note sheet).
const PENCIL = '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>';
const pencilSvg = (color: ColorProp) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${svgColor(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PENCIL}</svg>`;

/** Frame of every widget: rounded card in the widget's background. */
function Frame({ p, children, radius = 24, padding = 12 }: { p: Palette; children: unknown; radius?: number; padding?: number }) {
  return (
    <FlexWidget style={{ width: "match_parent", height: "match_parent", flexDirection: "column", padding, borderRadius: radius, backgroundColor: p.bg, borderWidth: 1, borderColor: p.line }}>
      {children}
    </FlexWidget>
  );
}

/** Title, date line and the round buttons on the right. */
function Header({ p, title, sub, link, children }: { p: Palette; title: string; sub: string; link: string; children?: unknown }) {
  return (
    <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center", paddingBottom: 8, paddingHorizontal: 2 }}>
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: link }} style={{ flex: 1, flexDirection: "column" }}>
        <TextWidget text={title} maxLines={1} style={ts(p, { fontSize: 16, fontWeight: "700", color: p.text })} />
        <TextWidget text={sub} maxLines={1} truncate="END" style={ts(p, { fontSize: 11, color: p.muted })} />
      </FlexWidget>
      {children}
    </FlexWidget>
  );
}

function RoundButton({ p, icon, click, data, label, primary }: { p: Palette; icon: IconName; click: string; data?: Record<string, unknown>; label: string; primary?: boolean }) {
  return (
    <FlexWidget
      clickAction={click}
      clickActionData={data}
      accessibilityLabel={label}
      style={{ width: 32, height: 32, marginLeft: 6, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: primary ? p.accent : p.surface }}
    >
      <Ico name={icon} color={primary ? p.onAccent : p.text} size={16} />
    </FlexWidget>
  );
}

function Empty({ p, icon, title, sub, link }: { p: Palette; icon: IconName; title: string; sub: string; link: string }) {
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: link }} style={{ flex: 1, width: "match_parent", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <FlexWidget style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.accentSoft, marginBottom: 8 }}>
        <Ico name={icon} color={p.accent} size={20} />
      </FlexWidget>
      <TextWidget text={title} style={ts(p, { fontSize: 13, fontWeight: "600", color: p.text, textAlign: "center" })} />
      <TextWidget text={sub} maxLines={2} style={ts(p, { fontSize: 11, color: p.muted, textAlign: "center" })} />
    </FlexWidget>
  );
}

const updatedAt = (now: Date) => `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

// --- Schnellerfassung ------------------------------------------------------------------------------

function Capture({ p, width, height }: { p: Palette; width: number; height: number }) {
  const compact = width < 230;
  const tall = height >= 100;
  const button = (kind: "voice" | "note" | "photo", label: string, primary: boolean) => {
    const fg = primary ? p.onAccent : p.text;
    return (
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: kind === "photo" ? captureLink(kind) : quickLink(kind) }}
        accessibilityLabel={label}
        style={{ flex: 1, height: "match_parent", flexDirection: "row", alignItems: "center", justifyContent: "center", flexGap: 8, borderRadius: 999, backgroundColor: primary ? p.accent : p.surface, marginHorizontal: 3 }}
      >
        {kind === "note" ? <SvgWidget svg={pencilSvg(fg)} style={{ width: 20, height: 20 }} /> : <Ico name={kind === "voice" ? "mic" : "camera"} color={fg} size={20} />}
        {!compact && <TextWidget text={label} style={{ fontSize: 13, fontWeight: "600", color: fg }} />}
      </FlexWidget>
    );
  };
  // One row: the buttons fill the pill's full height. Two rows: the row takes the lower half (weight), not
  // match_parent, which would push the ask bar out. A wrap_content row made the buttons collapse to the text height.
  const row = (
    <FlexWidget style={tall ? { width: "match_parent", flex: 1, flexDirection: "row", alignItems: "center" } : { width: "match_parent", height: "match_parent", flexDirection: "row", alignItems: "center" }}>
      {button("voice", tx("widget", "Voice"), true)}
      {button("note", t("Note"), false)}
      {button("photo", t("Photo"), false)}
    </FlexWidget>
  );
  if (!tall)
    return (
      <FlexWidget style={{ width: "match_parent", height: "match_parent", flexDirection: "row", alignItems: "center", padding: 5, borderRadius: 999, backgroundColor: p.bg, borderWidth: 1, borderColor: p.line }}>
        {row}
      </FlexWidget>
    );
  return (
    <Frame p={p} radius={28} padding={8}>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: tabLink("agent") }}
        style={{ width: "match_parent", flex: 1, flexDirection: "row", alignItems: "center", flexGap: 10, paddingHorizontal: 16, marginHorizontal: 3, marginBottom: 8, borderRadius: 999, backgroundColor: p.surface }}
      >
        <Ico name="sparkles" color={p.accent} size={18} />
        <TextWidget text={t("Ask Kortex or give it a task")} maxLines={1} truncate="END" style={{ fontSize: 14, color: p.muted }} />
      </FlexWidget>
      {row}
    </Frame>
  );
}

// --- Heute -------------------------------------------------------------------------------------------

/** Small text pill inside a row (put off a reminder, file an inbox entry). */
function Pill({ p, text, click, data, label, icon, strong, ml = 6 }: { p: Palette; text: string; click: string; data: Record<string, unknown>; label: string; icon?: IconName; strong?: boolean; ml?: number }) {
  return (
    <FlexWidget
      clickAction={click}
      clickActionData={data}
      accessibilityLabel={label}
      style={{ height: 28, flexDirection: "row", alignItems: "center", flexGap: 4, paddingHorizontal: 10, marginLeft: ml, borderRadius: 14, backgroundColor: strong ? p.accent : p.accentSoft }}
    >
      {icon && <Ico name={icon} color={strong ? p.onAccent : p.accent} size={13} stroke={2.5} />}
      <TextWidget text={text} maxLines={1} style={{ fontSize: 11, fontWeight: "700", color: strong ? p.onAccent : p.accent }} />
    </FlexWidget>
  );
}

/** Small round icon button inside a card (star, read). */
function IconToggle({ p, icon, on, click, data, label }: { p: Palette; icon: IconName; on: boolean; click: string; data: Record<string, unknown>; label: string }) {
  return (
    <FlexWidget clickAction={click} clickActionData={data} accessibilityLabel={label} style={{ width: 30, height: 30, marginLeft: 2, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: on ? p.accentSoft : c("rgba(0, 0, 0, 0)") }}>
      <Ico name={icon} color={on ? p.accent : p.muted} size={15} stroke={on ? 2.5 : 2} />
    </FlexWidget>
  );
}

function TodayItem({ p, r, wide }: { p: Palette; r: TodayRow; wide: boolean }) {
  // The circle completes a task, clears a reminder or marks a radar change as seen, right in the widget.
  const click = r.done ? undefined : r.kind === "task" ? CLICK.taskDone : CLICK.dueDone;
  const data = r.done ? undefined : r.kind === "task" ? { id: r.taskId } : { id: r.dueId, kind: r.kind };
  const ring = r.done ? p.accent : r.overdue ? p.crit : r.kind === "task" ? p.muted : p.accent;
  const lead = (
    <FlexWidget clickAction={click} clickActionData={data} accessibilityLabel={r.kind === "radar" ? t("Seen") : t("Mark as done")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
      <FlexWidget style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: ring, backgroundColor: r.done ? p.accent : c("rgba(0, 0, 0, 0)"), alignItems: "center", justifyContent: "center" }}>
        {r.done ? <Ico name="check" color={p.onAccent} size={14} stroke={3} /> : r.kind !== "task" && <Ico name={r.kind === "radar" ? "eye" : "bell"} color={p.accent} size={10} stroke={2.5} />}
      </FlexWidget>
    </FlexWidget>
  );
  const later =
    r.kind === "reminder" && !r.done && r.dueId ? (
      <FlexWidget style={{ flexDirection: "row", alignItems: "center" }}>
        <Pill p={p} text={t("+1 h")} click={CLICK.snooze} data={{ id: r.dueId, title: r.title, when: "hour" }} label={t("Remind me in an hour")} />
        {wide && <Pill p={p} text={t("Tomorrow")} click={CLICK.snooze} data={{ id: r.dueId, title: r.title, when: "tomorrow" }} label={t("Remind me tomorrow")} />}
      </FlexWidget>
    ) : null;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: r.link }}
      style={{ width: "match_parent", flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingLeft: 2, paddingRight: 8, marginBottom: 6, borderRadius: 14, backgroundColor: p.surface }}
    >
      {lead}
      <FlexWidget style={{ flex: 1, flexDirection: "column", marginLeft: 4 }}>
        <TextWidget text={r.title} maxLines={2} truncate="END" style={{ fontSize: 13, fontWeight: "600", color: r.done ? p.muted : p.text }} />
        <TextWidget text={r.done ? (r.kind === "radar" ? t("Seen") : t("Done")) : r.meta} maxLines={1} style={{ fontSize: 11, color: r.done ? p.muted : r.overdue ? p.crit : r.kind === "task" ? p.muted : p.accent }} />
      </FlexWidget>
      {later}
    </FlexWidget>
  );
}

function Today({ p, model, width }: { p: Palette; model: TodayModel | null; width: number }) {
  const now = new Date();
  const open = model ? model.rows.filter((r) => !r.done).length + model.more : 0;
  return (
    <Frame p={p}>
      <Header p={p} title={t("Today")} sub={`${widgetDate(now)} · ${model ? tn(open, "{n} open", "{n} open") : t("not loaded")}`} link={tabLink("tasks")}>
        <RoundButton p={p} icon="sync" click={CLICK.refresh} label={t("Refresh")} />
        <RoundButton p={p} icon="plus" click="OPEN_URI" data={{ uri: quickLink("task") }} label={t("New task")} primary />
      </Header>
      {!model ? (
        <Empty p={p} icon="sync" title={t("Open Kortex to load")} sub={t("Signed out or offline")} link="kortex://open" />
      ) : model.rows.length === 0 ? (
        <Empty p={p} icon="check" title={t("All done")} sub={t("Nothing due today")} link={tabLink("tasks")} />
      ) : (
        <FlexWidget style={{ flex: 1, width: "match_parent" }}>
          <ListWidget style={{ width: "match_parent", height: "match_parent" }}>
            {model.rows.map((r) => (
              <TodayItem key={r.key} p={p} r={r} wide={width >= 250} />
            ))}
          </ListWidget>
        </FlexWidget>
      )}
    </Frame>
  );
}

// --- Einträge ----------------------------------------------------------------------------------------

const KIND_TONE: Record<EntryKind, TagTone> = { note: "ai", meeting: "strategy", read: "auto", video: "finance", food: "food", ai: "ai", object: "health" };
const SOURCE_LABEL: Record<EntrySource, () => string> = { recent: () => t("New"), favorites: () => t("Favorites"), inbox: () => t("Inbox") };
const SOURCE_EMPTY: Record<EntrySource, () => string> = {
  recent: () => t("Captured entries show up here"),
  favorites: () => t("Star an entry to keep it here"),
  inbox: () => t("Everything is filed"),
};

function EntryItem({ p, e }: { p: Palette; e: EntryCard }) {
  const tone = p.tone(KIND_TONE[e.kind]);
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: e.link }}
      style={{ width: "match_parent", flexDirection: "row", padding: 10, paddingBottom: 6, marginBottom: 6, borderRadius: 16, backgroundColor: p.surface }}
    >
      <FlexWidget style={{ width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: tone.bg, marginRight: 10 }}>
        <Ico name={typeIconName(e.type)} color={tone.fg} size={18} />
      </FlexWidget>
      <FlexWidget style={{ flex: 1, flexDirection: "column" }}>
        <TextWidget text={e.title} maxLines={2} truncate="END" style={{ fontSize: 13, fontWeight: "600", color: e.read ? p.muted : p.text }} />
        {!!e.line && <TextWidget text={e.line} maxLines={2} truncate="END" style={{ fontSize: 12, color: p.muted, marginTop: 2 }} />}
        <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center", marginTop: 2 }}>
          <FlexWidget style={{ flex: 1 }}>
            <TextWidget text={e.meta} maxLines={1} truncate="END" style={{ fontSize: 10, color: e.processing ? p.accent : p.muted }} />
          </FlexWidget>
          <IconToggle p={p} icon="star" on={e.fav} click={CLICK.fav} data={{ id: e.key, on: !e.fav }} label={e.fav ? t("Remove from favorites") : t("Add to favorites")} />
          <IconToggle p={p} icon="book" on={e.read} click={CLICK.read} data={{ id: e.key, on: !e.read }} label={e.read ? t("Mark as unread") : t("Mark as read")} />
        </FlexWidget>
        {e.target && (
          <FlexWidget style={{ flexDirection: "row", marginTop: 4, marginBottom: 4 }}>
            <Pill p={p} text={t("Fits: {folder}", { folder: e.targetLabel ?? e.target })} click={CLICK.file} data={{ id: e.key, target: e.target }} label={t("File into {folder}", { folder: e.target })} icon="check" strong ml={0} />
          </FlexWidget>
        )}
      </FlexWidget>
    </FlexWidget>
  );
}

function Entries({ p, cards, source, width }: { p: Palette; cards: readonly EntryCard[] | null; source: EntrySource; width: number }) {
  const chip = (s: EntrySource) => {
    const on = s === source;
    return (
      <FlexWidget
        key={s}
        clickAction={CLICK.source}
        clickActionData={{ source: s }}
        style={{ paddingHorizontal: 12, paddingVertical: 6, marginRight: 6, borderRadius: 999, backgroundColor: on ? p.accent : p.surface }}
      >
        <TextWidget text={SOURCE_LABEL[s]()} style={{ fontSize: 12, fontWeight: "600", color: on ? p.onAccent : p.text }} />
      </FlexWidget>
    );
  };
  return (
    <Frame p={p}>
      <Header p={p} title={t("Entries")} sub={`${SOURCE_LABEL[source]()} · ${t("updated {time}", { time: updatedAt(new Date()) })}`} link={source === "inbox" ? tabLink("inbox") : tabLink("entries")}>
        <RoundButton p={p} icon="sync" click={CLICK.refresh} label={t("Refresh")} />
      </Header>
      <FlexWidget style={{ width: "match_parent", flexDirection: "row", paddingBottom: 8 }}>{(width < 240 ? ENTRY_SOURCES.filter((s) => s !== "inbox") : ENTRY_SOURCES).map(chip)}</FlexWidget>
      {!cards ? (
        <Empty p={p} icon="sync" title={t("Open Kortex to load")} sub={t("Signed out or offline")} link="kortex://open" />
      ) : cards.length === 0 ? (
        <Empty p={p} icon={source === "favorites" ? "star" : source === "inbox" ? "inbox" : "note"} title={t("Nothing here yet")} sub={SOURCE_EMPTY[source]()} link={tabLink("entries")} />
      ) : (
        <FlexWidget style={{ flex: 1, width: "match_parent" }}>
          <ListWidget style={{ width: "match_parent", height: "match_parent" }}>
            {cards.map((e) => (
              <EntryItem key={e.key} p={p} e={e} />
            ))}
          </ListWidget>
        </FlexWidget>
      )}
    </Frame>
  );
}

// --- Energie-Check-in ---------------------------------------------------------------------------------

function Checkin({ p, model, height }: { p: Palette; model: CheckinModel | null; height: number }) {
  const tall = height >= 130;
  if (!model)
    return (
      <Frame p={p}>
        <Empty p={p} icon="flame" title={t("Open Kortex to load")} sub={t("Signed out or offline")} link="kortex://open" />
      </Frame>
    );
  const box = (n: number) => {
    const on = model.energy != null && n <= model.energy;
    return (
      <FlexWidget
        key={n}
        clickAction={CLICK.energy}
        clickActionData={{ n }}
        accessibilityLabel={t("Energy {n} of 10", { n })}
        style={{ flex: 1, height: "match_parent", marginHorizontal: 2, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: on ? p.accent : p.surface }}
      >
        <TextWidget text={String(n)} style={{ fontSize: 12, fontWeight: "700", color: on ? p.onAccent : p.muted }} />
      </FlexWidget>
    );
  };
  return (
    <Frame p={p} padding={10}>
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: tabLink("journal") }} style={{ width: "match_parent", flexDirection: "row", alignItems: "center", paddingBottom: 8, paddingHorizontal: 2 }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={model.energy == null ? t("How is your energy today?") : t("Energy today: {n}/10", { n: model.energy })}
            maxLines={1}
            truncate="END"
            style={ts(p, { fontSize: 13, fontWeight: "700", color: p.text })}
          />
        </FlexWidget>
        {model.streak > 0 && (
          <FlexWidget style={{ flexDirection: "row", alignItems: "center", flexGap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: p.accentSoft }}>
            <Ico name="flame" color={p.accent} size={12} />
            <TextWidget text={tn(model.streak, "{n} day", "{n} days")} style={{ fontSize: 11, fontWeight: "600", color: p.accent }} />
          </FlexWidget>
        )}
      </FlexWidget>
      <FlexWidget style={{ width: "match_parent", height: tall ? 36 : "match_parent", flex: tall ? 0 : 1, flexDirection: "row" }}>{Array.from({ length: 10 }, (_, i) => box(i + 1))}</FlexWidget>
      {tall && (
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: tabLink("journal") }} style={{ width: "match_parent", flex: 1, flexDirection: "row", alignItems: "flex-end", paddingTop: 10 }}>
          {model.week.map((d) => (
            <FlexWidget key={d.day} style={{ flex: 1, height: "match_parent", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
              <FlexWidget
                style={{ width: 14, height: Math.max(4, Math.round(((d.energy ?? 0) / 10) * Math.max(12, height - 130))), borderRadius: 4, backgroundColor: d.energy == null ? p.surface : d.day === model.date ? p.accent : p.accentSoft }}
              />
              <TextWidget text={d.label} style={ts(p, { fontSize: 10, color: d.day === model.date ? p.text : p.muted, marginTop: 3 })} />
            </FlexWidget>
          ))}
        </FlexWidget>
      )}
    </Frame>
  );
}

// --- Entry point ---------------------------------------------------------------------------------------

export interface WidgetData {
  today?: TodayModel | null;
  entries?: readonly EntryCard[] | null;
  checkin?: CheckinModel | null;
}

const styleOf = (s: AppStyle | string): AppStyle => (typeof s === "string" ? { accent: s, look: "ruhe" } : s);

export type { AppStyle };

/** One widget in one theme. */
export function widgetElement(name: string, theme: ThemeName, style: AppStyle | string, size: { width: number; height: number }, look: WidgetSettings, data: WidgetData) {
  const { accent, look: appLook } = styleOf(style);
  const p = paletteOf(createTheme(theme, accent, appLook), look.opacity);
  if (name === WIDGET_CAPTURE) return <Capture p={p} width={size.width} height={size.height} />;
  if (name === WIDGET_ENTRIES) return <Entries p={p} cards={data.entries ?? null} source={look.source} width={size.width} />;
  if (name === WIDGET_CHECKIN) return <Checkin p={p} model={data.checkin ?? null} height={size.height} />;
  return <Today p={p} model={data.today ?? null} width={size.width} />;
}

/** Light and dark variant (Android picks by the system theme), or one fixed look. */
export function renderWidget(name: string, style: AppStyle | string, size: { width: number; height: number }, look: WidgetSettings, data: WidgetData): WidgetRepresentation {
  if (look.theme !== "system") return widgetElement(name, look.theme, style, size, look, data);
  return { light: widgetElement(name, "light", style, size, look, data), dark: widgetElement(name, "dark", style, size, look, data) };
}
