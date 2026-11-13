import { FlexWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import type { WidgetInfo, WidgetRepresentation } from "react-native-android-widget";
import { secureStorage } from "../api/kortex";
import { t, tx } from "../i18n";
import { createTheme, DEFAULT_ACCENT, type Theme, type ThemeName } from "../theme/tokens";
import { captureLink } from "../notify/plan";
import { WIDGET_CAPTURE, type TodayModel } from "./model";

/*
 * The two widgets as widget JSX (react-native-android-widget draws it natively). Colours come from the app tokens.
 * Texts are read when a widget is drawn; the headless callers restore the stored language first (src/i18n/device.ts).
 */

type Hex = `#${string}`;
type Rgba = `rgba(${number}, ${number}, ${number}, ${number})`;
type Color = Hex | Rgba;

export interface Palette {
  bg: Color;
  surface: Color;
  line: Color;
  text: Color;
  muted: Color;
  accent: Color;
  onAccent: Color;
}

export function paletteOf(th: Theme): Palette {
  return {
    bg: th.lum1 as Color,
    surface: th.lum3 as Color,
    line: th.hairStrong as Color,
    text: th.t1 as Color,
    muted: th.t3 as Color,
    accent: th.accentFill as Color,
    onAccent: th.onAccent as Color,
  };
}

/** The accent the user picked (kept in the app prefs); the default when none or unreadable. */
export async function storedAccent(): Promise<string> {
  try {
    const raw = await secureStorage.getItem("kortex.prefs");
    const a = raw ? (JSON.parse(raw) as { accent?: string }).accent : undefined;
    return typeof a === "string" && a ? a : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

const icon = (paths: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
// Lucide line icons (mic, pencil-line, camera), like the in-app capture fan.
const MIC = '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>';
const NOTE = '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>';
const CAMERA = '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>';

function CapturePill({ p }: { p: Palette }) {
  const button = (kind: "voice" | "note" | "photo", paths: string, label: string, primary: boolean) => (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: captureLink(kind) }}
      style={{
        flex: 1,
        height: "match_parent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexGap: 8,
        borderRadius: 999,
        backgroundColor: primary ? p.accent : p.surface,
        marginHorizontal: 3,
      }}
    >
      <SvgWidget svg={icon(paths, primary ? p.onAccent : p.text)} style={{ width: 20, height: 20 }} />
      <TextWidget text={label} style={{ fontSize: 13, fontWeight: "600", color: primary ? p.onAccent : p.text }} />
    </FlexWidget>
  );
  return (
    <FlexWidget
      style={{ width: "match_parent", height: "match_parent", flexDirection: "row", alignItems: "center", padding: 5, borderRadius: 999, backgroundColor: p.bg, borderWidth: 1, borderColor: p.line }}
    >
      {button("voice", MIC, tx("widget", "Voice"), true)}
      {button("note", NOTE, t("Note"), false)}
      {button("photo", CAMERA, t("Photo"), false)}
    </FlexWidget>
  );
}

function Today({ p, model, error }: { p: Palette; model: TodayModel | null; error: boolean }) {
  return (
    <FlexWidget style={{ width: "match_parent", height: "match_parent", flexDirection: "column", padding: 12, borderRadius: 20, backgroundColor: p.bg, borderWidth: 1, borderColor: p.line }}>
      <FlexWidget clickAction="OPEN_APP" style={{ width: "match_parent", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 6 }}>
        <TextWidget text={t("Today")} style={{ fontSize: 16, fontWeight: "700", color: p.text }} />
        {model && model.total > 0 && (
          <FlexWidget style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: p.accent }}>
            <TextWidget text={String(model.total)} style={{ fontSize: 12, fontWeight: "700", color: p.onAccent }} />
          </FlexWidget>
        )}
      </FlexWidget>
      {!model || model.rows.length === 0 ? (
        <FlexWidget clickAction="OPEN_APP" style={{ flex: 1, width: "match_parent", justifyContent: "center" }}>
          <TextWidget text={error || !model ? t("Open Kortex to load") : t("Nothing due")} style={{ fontSize: 13, color: p.muted }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flex: 1, width: "match_parent", flexDirection: "column" }}>
          {model.rows.map((r) => (
            <FlexWidget
              key={r.key}
              clickAction="OPEN_URI"
              clickActionData={{ uri: r.link }}
              style={{ width: "match_parent", flexDirection: "column", paddingVertical: 4, paddingHorizontal: 8, marginBottom: 4, borderRadius: 10, backgroundColor: p.surface }}
            >
              <TextWidget text={r.title} maxLines={1} truncate="END" style={{ fontSize: 13, fontWeight: "600", color: p.text }} />
              <TextWidget text={r.meta} maxLines={1} style={{ fontSize: 11, color: r.kind === "task" ? p.muted : p.accent }} />
            </FlexWidget>
          ))}
          {model.more > 0 && <TextWidget text={t("+ {n} more", { n: model.more })} style={{ fontSize: 11, color: p.muted }} />}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

/** Light and dark variant of one widget; Android picks by the system theme. */
export function renderWidget(name: string, accent: string, _info: WidgetInfo, today: { model: TodayModel | null; error: boolean }): WidgetRepresentation {
  const pair = (theme: ThemeName) => {
    const p = paletteOf(createTheme(theme, accent));
    return name === WIDGET_CAPTURE ? <CapturePill p={p} /> : <Today p={p} model={today.model} error={today.error} />;
  };
  return { light: pair("light"), dark: pair("dark") };
}
