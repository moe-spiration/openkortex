import { useState } from "react";
import { Image, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SPEC, focusX, type LumTopic, type TileTopic, type TopicId } from "@kortex/theme-packs";
import { useApp } from "../state/AppState";
import { alpha } from "./color";
import { PACK_IMAGES } from "./packAssets.gen";
import { usePack } from "./pack";
import { useTheme } from "./ThemeProvider";
import { accentHex } from "./tokens";

/*
 * Theme pack images on Android (WebP rasters, no SVG: react-native-svg filters are unreliable). React Native has no
 * object-position and no mix-blend-mode, so the cover maths and the accent tint are done by hand:
 *  - CoverImage: object-fit: cover with a focus point (spec 7: focus.x for portrait screens, tiles aligned to the top).
 *  - Accent tint: luminance image plus a flat accent colour (approximation of blend mode "color", spec 6). To be judged
 *    on a real device (acceptance P6); Skia's BlendMode.Color is the upgrade if it does not look right.
 */

const FULL_ASPECT = SPEC.full.w / SPEC.full.h;
const TILE_ASPECT = SPEC.tile.w / SPEC.tile.h;
/** Approximation of the web tint (mix-blend-mode: color at .85 dark / .75 light) with a plain overlay. */
const TINT_OPACITY = { dark: 0.6, light: 0.55 } as const;

type Source = number | { uri: string };

/** `object-fit: cover; object-position: fx fy` for a bitmap of the given aspect ratio. */
export function CoverImage({ source, aspect, fx = 0.5, fy = 0.5, onError }: { source: Source; aspect: number; fx?: number; fy?: number; onError?: () => void }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
  };
  const w = box ? Math.max(box.w, box.h * aspect) : 0;
  const h = w / aspect;
  return (
    <View pointerEvents="none" onLayout={onLayout} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, overflow: "hidden" }}>
      {box && w > 0 ? (
        <Image
          source={source}
          resizeMode="stretch"
          onError={onError}
          style={{ position: "absolute", width: w, height: h, left: -(w - box.w) * fx, top: -(h - box.h) * fy }}
        />
      ) : null}
    </View>
  );
}

/** Accent colour (hex) of the app's current accent (preset or free hex colour). */
function useAccentHex(): string {
  const { accent } = useApp();
  return accentHex(accent);
}

/**
 * Fullscreen background of a fixed surface (spec 5.2): baked image, optional accent tint, scrim into `bg`.
 * Absolutely positioned at the top of its parent; the content goes above it. Renders nothing before the stored pack
 * is known or when the image fails to load (F10).
 */
export function PackHero(props: { topic: TopicId; height: number; bg?: string; style?: ViewStyle } & ({ tint: true; topic: LumTopic } | { tint?: false })) {
  const th = useTheme();
  const { pack, ready, mode } = usePack();
  const accent = useAccentHex();
  const [failed, setFailed] = useState<string | null>(null);
  const key = `${pack}/${mode}/${props.topic}`;
  if (!ready || failed === key) return null;
  const img = PACK_IMAGES[pack][mode][props.topic];
  const source = props.tint ? img.lum : img.full;
  if (!source) return null;
  const bg = props.bg ?? th.bgMainWindow;
  return (
    <View pointerEvents="none" style={[{ position: "absolute", left: 0, right: 0, top: 0, height: props.height, overflow: "hidden", backgroundColor: bg }, props.style]}>
      <CoverImage source={source as Source} aspect={FULL_ASPECT} fx={focusX(props.topic)} onError={() => setFailed(key)} />
      {props.tint ? <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: accent, opacity: TINT_OPACITY[mode] }} /> : null}
      <LinearGradient
        colors={[alpha(bg, 0), alpha(bg, 0.22), alpha(bg, 0.82), bg]}
        locations={[0, 0.3, 0.56, 1]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
    </View>
  );
}

/** Type or area tile of the active pack (spec 5.1): aligned to the top, used as a cover. */
export function PackTileImage({ topic }: { topic: TileTopic }) {
  const { pack, ready, mode } = usePack();
  const [failed, setFailed] = useState<string | null>(null);
  const key = `${pack}/${mode}/${topic}`;
  const source = PACK_IMAGES[pack][mode][topic].tile;
  if (!ready || !source || failed === key) return null;
  return <CoverImage source={source as Source} aspect={TILE_ASPECT} fy={0} onError={() => setFailed(key)} />;
}
