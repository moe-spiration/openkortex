"use client";

import { useState, type CSSProperties } from "react";
import { focusX, fullSources, lumSources, type LumTopic, type TopicId } from "@kortex/theme-packs";
import { useThemePack } from "@/lib/theme/pack";

type Props = {
  /** Height of the background (CSS length); the scrim fades into `bg` at the bottom. Default: the whole parent. */
  height?: CSSProperties["height"];
  /** Colour the scrim fades into: the surface the hero sits on. Default: the main window. */
  bg?: string;
  className?: string;
  style?: CSSProperties;
} & ({ topic: LumTopic; /** Follow the accent colour (home, review). */ tint: true } | { topic: TopicId; tint?: false });

/**
 * Fullscreen background of a fixed surface (spec 5.2 and 6): baked image, optional accent tint, scrim on top.
 * Absolutely positioned inside a `position: relative` parent; content goes above it (z-index 1).
 * A missing file (or no pack data) renders nothing, so the surface keeps its plain background (F10).
 */
export function ThemeHero(props: Props) {
  const { pack, ready, mode, base } = useThemePack();
  const [failed, setFailed] = useState<string | null>(null);
  // AVIF that cannot be loaded (blocked, corrupt, offline CDN) is retried once as WebP before the hero is given up.
  const [noAvif, setNoAvif] = useState<string | null>(null);
  const key = `${pack}/${mode}/${props.topic}`;
  if (!ready || failed === key) return null;

  const src = props.tint ? lumSources(pack, mode, props.topic, base) : fullSources(pack, mode, props.topic, base);
  const style = {
    "--pack-fx": focusX(props.topic),
    ...(props.height !== undefined ? { "--pack-h": typeof props.height === "number" ? `${props.height}px` : props.height } : null),
    ...(props.bg ? { "--pack-bg": props.bg } : null),
    ...props.style,
  } as CSSProperties;

  return (
    <div className={`kx-pack-hero${props.className ? ` ${props.className}` : ""}`} style={style} aria-hidden data-pack={pack}>
      <picture>
        {noAvif !== key && <source type="image/avif" srcSet={src.avif} />}
        <img src={src.webp} alt="" decoding="async" fetchPriority="high" onError={() => (noAvif === key ? setFailed(key) : setNoAvif(key))} />
      </picture>
      {props.tint && <div className="kx-pack-tint" />}
      <div className="kx-pack-scrim" />
    </div>
  );
}
