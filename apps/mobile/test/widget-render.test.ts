import { describe, expect, it, vi } from "vitest";

// The widget primitives only touch react-native for require()d images; the widgets here draw SVG strings.
vi.mock("react-native", () => ({ Image: { resolveAssetSource: (x: unknown) => x }, Platform: { OS: "android" } }));
vi.mock("expo-secure-store", () => ({}));
// The package index also loads the native module; the widgets themselves are plain JS.
vi.mock("react-native-android-widget", async () => ({
  ...(await import("react-native-android-widget/lib/module/widgets/FlexWidget.js")),
  ...(await import("react-native-android-widget/lib/module/widgets/ListWidget.js")),
  ...(await import("react-native-android-widget/lib/module/widgets/SvgWidget.js")),
  ...(await import("react-native-android-widget/lib/module/widgets/TextWidget.js")),
}));

const { buildWidgetTree } = await import("react-native-android-widget/lib/module/api/build-widget-tree.js");
const { renderWidget } = await import("../src/widgets/render");
const { buildCheckin, buildEntries, buildToday, CLICK, WIDGET_CAPTURE, WIDGET_CHECKIN, WIDGET_ENTRIES, WIDGET_TODAY } = await import("../src/widgets/model");

const now = new Date(2026, 10, 4, 10, 0);
const look = { opacity: 0.3, theme: "system" as const, source: "recent" as const };
const look_ = { ...look, opacity: 1 };
const today = buildToday(
  [{ id: "r1", title: "Zahnarzt anrufen", remind_at: new Date(2026, 10, 4, 9).toISOString(), kind: "reminder" }],
  [{ id: "t1", title: "Angebot schicken", status: "open", priority: "high", due_date: "2026-11-02", source_item_id: null, created_at: "" }],
  now,
  40,
);
const entries = buildEntries([{ id: "e1", type: "meeting", title: "Weekly", summary: "Kurz", content_md: null, status: "processed", is_favorite: true, created_at: now.toISOString() }], now);
const checkin = buildCheckin("2026-11-04", { "2026-11-03": 6 }, 2, 7);

type Node = { type: string; props: Record<string, unknown>; children?: Node[] };
const types = (n: Node): string[] => [n.type, ...(n.children ?? []).flatMap(types)];
const clicks = (n: Node): { action: unknown; data: unknown }[] => [
  ...(n.props.clickAction ? [{ action: n.props.clickAction, data: n.props.clickActionData }] : []),
  ...(n.children ?? []).flatMap(clicks),
];
const tree = (name: string, size: { width: number; height: number }, data: object) => buildWidgetTree((renderWidget(name, "indigo", size, look, data) as { light: unknown }).light) as Node;

describe("widget trees", () => {
  for (const [name, size, data] of [
    [WIDGET_TODAY, { width: 320, height: 300 }, { today }],
    [WIDGET_TODAY, { width: 320, height: 300 }, { today: null }],
    [WIDGET_ENTRIES, { width: 320, height: 400 }, { entries }],
    [WIDGET_ENTRIES, { width: 200, height: 400 }, { entries: [] }],
    [WIDGET_CHECKIN, { width: 320, height: 80 }, { checkin }],
    [WIDGET_CHECKIN, { width: 320, height: 200 }, { checkin }],
    [WIDGET_CAPTURE, { width: 320, height: 60 }, {}],
    [WIDGET_CAPTURE, { width: 180, height: 130 }, {}],
  ] as const) {
    it(`${name} ${size.width}x${size.height} builds in light and dark`, () => {
      const rep = renderWidget(name, "indigo", size, look, data) as { light: unknown; dark: unknown };
      for (const el of [rep.light, rep.dark]) {
        const tree = buildWidgetTree(el) as Node;
        expect(tree.type).toBe("LinearLayoutWidget");
        if ((name === WIDGET_TODAY && data.today) || (name === WIDGET_ENTRIES && "entries" in data && data.entries?.length)) expect(types(tree)).toContain("ListWidget");
      }
    });
  }

  it("capture buttons fill the pill's height in one row (no collapse to text height)", () => {
    for (const width of [320, 180]) {
      const tree = buildWidgetTree((renderWidget(WIDGET_CAPTURE, "indigo", { width, height: 60 }, look, {}) as { light: unknown }).light) as Node;
      const row = tree.children![0]!;
      expect(row.props.height).toBe("match_parent");
      for (const b of row.children!) expect(b.props.height).toBe("match_parent");
    }
  });

  it("note and voice open the quick overlay, photo still opens the app camera", () => {
    const uris = clicks(tree(WIDGET_CAPTURE, { width: 320, height: 60 }, {})).map((c) => (c.data as { uri: string }).uri);
    expect(uris).toEqual(["kortexquick://capture?kind=voice", "kortexquick://capture?kind=note", "kortex://open?capture=photo"]);
  });

  it("Heute: a reminder can be done or put off in the widget, the + opens a quick task", () => {
    const all = clicks(tree(WIDGET_TODAY, { width: 320, height: 300 }, { today }));
    expect(all).toContainEqual({ action: CLICK.dueDone, data: { id: "r1", kind: "reminder" } });
    expect(all).toContainEqual({ action: CLICK.snooze, data: { id: "r1", title: "Zahnarzt anrufen", when: "hour" } });
    expect(all).toContainEqual({ action: CLICK.snooze, data: { id: "r1", title: "Zahnarzt anrufen", when: "tomorrow" } });
    expect(all).toContainEqual({ action: CLICK.taskDone, data: { id: "t1" } });
    expect(all).toContainEqual({ action: "OPEN_URI", data: { uri: "kortexquick://capture?kind=task" } });
    // Narrow: only "+1 h" fits.
    const narrow = clicks(tree(WIDGET_TODAY, { width: 200, height: 300 }, { today })).filter((c) => c.action === CLICK.snooze);
    expect(narrow.map((c) => (c.data as { when: string }).when)).toEqual(["hour"]);
  });

  it("Einträge: star and read toggle in the card, an inbox suggestion files with one tap", () => {
    const inbox = buildEntries([{ id: "i1", type: "article", title: "Artikel", summary: null, content_md: "x", status: "processed", is_favorite: false, created_at: now.toISOString(), read_at: null, target: "20_Projects/Kortex" }], now);
    const all = clicks(tree(WIDGET_ENTRIES, { width: 320, height: 400 }, { entries: inbox }));
    expect(all).toContainEqual({ action: CLICK.fav, data: { id: "i1", on: true } });
    expect(all).toContainEqual({ action: CLICK.read, data: { id: "i1", on: true } });
    expect(all).toContainEqual({ action: CLICK.file, data: { id: "i1", target: "20_Projects/Kortex" } });
    const fav = clicks(tree(WIDGET_ENTRIES, { width: 320, height: 400 }, { entries }));
    expect(fav).toContainEqual({ action: CLICK.fav, data: { id: "e1", on: false } });
    expect(fav.some((c) => c.action === CLICK.file)).toBe(false);
  });

  it("Ruhe look: the widgets take the Ruhe tokens and drop the coloured type tiles", async () => {
    const { createTheme } = await import("../src/theme/tokens");
    const colours = (n: Node): unknown[] =>
      [n.props.backgroundColor, n.props.color, ...(n.children ?? []).flatMap(colours)].filter(
        Boolean,
      );
    const draw = (look: "vivid" | "ruhe") =>
      buildWidgetTree(
        renderWidget(
          WIDGET_ENTRIES,
          { accent: "indigo", look },
          { width: 320, height: 400 },
          { ...look_, theme: "dark" },
          { entries },
        ) as never,
      ) as Node;
    const ruhe = JSON.stringify(colours(draw("ruhe")));
    const classic = JSON.stringify(colours(draw("vivid")));
    expect(ruhe).not.toBe(classic);
    const meeting = createTheme("dark", "indigo", "vivid").tags.strategy.dot.toUpperCase().slice(1);
    expect(classic.toUpperCase()).toContain(meeting);
    expect(ruhe.toUpperCase()).not.toContain(meeting);
  });

  it("a fixed look draws one variant", () => {
    const rep = renderWidget(WIDGET_TODAY, "indigo", { width: 300, height: 300 }, { ...look, theme: "dark" }, { today });
    expect("light" in (rep as object)).toBe(false);
  });
});
