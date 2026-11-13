import { t } from "../i18n";
import { createContext, useContext, useMemo, useState } from "react";
import { Image, Linking, View, type ViewStyle } from "react-native";
import { parseMarkdown, type Inline } from "../lib/markdown";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon } from "./Icon";
import { T } from "./primitives";

/* Renders an item's Markdown (content_md) on the phone: text, lists, quotes and images. [[Wiki-links]] are tappable. */

/** Tap on a `[[wiki-link]]`: gets the link target (title or path). */
const WikiTap = createContext<((target: string) => void) | null>(null);

function MdImage({ url, alt }: { url: string; alt: string }) {
  const th = useTheme();
  const [ratio, setRatio] = useState(16 / 9);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      accessibilityLabel={alt || t("Image")}
      source={{ uri: url }}
      resizeMode="cover"
      onLoad={(e) => {
        const { width, height } = e.nativeEvent.source;
        // Tiny images (icons, tracking pixels) are noise in a reader.
        if (width < 48 || height < 48) setFailed(true);
        else setRatio(Math.max(0.6, Math.min(2.4, width / height)));
      }}
      onError={() => setFailed(true)}
      style={{ width: "100%", aspectRatio: ratio, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted }}
    />
  );
}

function Spans({ parts, size, lh, weight, color, strike }: { parts: Inline[]; size: number; lh: number; weight?: 400 | 500 | 600; color?: string; strike?: boolean }) {
  const th = useTheme();
  const onWiki = useContext(WikiTap);
  return (
    <T size={size} lh={lh} weight={weight ?? 400} ls={0} color={color} style={strike ? { textDecorationLine: "line-through" } : undefined}>
      {parts.map((p, i) =>
        p.wiki && onWiki ? (
          <T key={i} accessibilityRole="link" size={size} lh={lh} weight={500} ls={0} color={th.accentAi} onPress={() => onWiki(p.wiki!)}>
            {p.text}
          </T>
        ) : p.href ? (
          <T key={i} size={size} lh={lh} weight={weight ?? 400} ls={0} color={th.accentAi} onPress={() => void Linking.openURL(p.href!)}>
            {p.text}
          </T>
        ) : p.code ? (
          <T key={i} mono size={size - 1} lh={lh} ls={0} color={th.textSecondary}>
            {p.text}
          </T>
        ) : p.bold ? (
          <T key={i} size={size} lh={lh} weight={600} ls={0} color={color}>
            {p.text}
          </T>
        ) : (
          p.text
        ),
      )}
    </T>
  );
}

export function Markdown({ md, onWiki }: { md: string; onWiki?: (target: string) => void }) {
  const th = useTheme();
  const blocks = useMemo(() => parseMarkdown(md), [md]);
  return (
    <WikiTap.Provider value={onWiki ?? null}>
    <View style={{ gap: 10 }}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <View key={i} style={{ marginTop: i ? 6 : 0 }}>
                <Spans parts={b.text} size={b.level === 1 ? 20 : b.level === 2 ? 17 : 15} lh={b.level === 1 ? 26 : 23} weight={600} />
              </View>
            );
          case "para":
            return <Spans key={i} parts={b.text} size={14.5} lh={22.5} color={th.textPrimary} />;
          case "bullet":
            return (
              <View key={i} style={{ flexDirection: "row", gap: 10, paddingLeft: 2 + (b.indent ?? 0) * 18 }}>
                {b.ordered !== undefined ? (
                  <T num size={13} lh={22} ls={0} color={th.textMuted} style={{ minWidth: 16 }}>{`${b.ordered}.`}</T>
                ) : b.task ? (
                  // "- [ ]" / "- [x]": a checkbox like in the editor, not a bullet.
                  <View accessibilityRole="checkbox" accessibilityState={{ checked: !!b.done }} style={{ marginTop: 2 }}>
                    <Icon name={b.done ? "checkSquare" : "square"} size={18} color={b.done ? th.accentAi : th.textSecondary} />
                  </View>
                ) : (
                  <View style={{ width: 5, height: 5, marginTop: 9, borderRadius: 3, backgroundColor: b.done ? th.statusSynced : th.textMuted }} />
                )}
                <View style={{ flex: 1 }}>
                  <Spans parts={b.text} size={14.5} lh={22} color={b.done ? th.textMuted : th.textPrimary} strike={b.task && b.done} />
                </View>
              </View>
            );
          case "quote":
            return (
              <View key={i} style={{ paddingLeft: 12, boxShadow: `inset 2px 0 0 0 ${th.borderSubtle}` } as ViewStyle}>
                <Spans parts={b.text} size={14.5} lh={22} color={th.textSecondary} />
              </View>
            );
          case "image":
            return <MdImage key={i} url={b.url} alt={b.alt} />;
          case "rule":
            return <View key={i} style={{ height: 1, backgroundColor: th.borderSubtle, marginVertical: 4 }} />;
        }
      })}
    </View>
    </WikiTap.Provider>
  );
}

