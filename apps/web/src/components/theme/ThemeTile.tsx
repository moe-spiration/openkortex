"use client";

import { useState, type CSSProperties } from "react";
import { tileSources, type TileTopic } from "@kortex/theme-packs";
import { useThemePack } from "@/lib/theme/pack";

/**
 * Type or area cover of the active pack for the upper part of a card (spec 5.1): the image fades out into the
 * card surface. Absolutely positioned inside a `position: relative` card, content goes above (z-index 1).
 * Renders nothing when the file is missing (F10).
 */
export function ThemeTile({ topic, height, className, style }: { topic: TileTopic; height?: CSSProperties["height"]; className?: string; style?: CSSProperties }) {
  const { pack, ready, mode, base } = useThemePack();
  const [failed, setFailed] = useState<string | null>(null);
  // The vector (or AVIF) tile that cannot be loaded is retried once as the WebP raster before the tile is given up.
  const [raster, setRaster] = useState<string | null>(null);
  const key = `${pack}/${mode}/${topic}`;
  if (!ready || failed === key) return null;
  const retry = () => (raster === key ? setFailed(key) : setRaster(key));

  const t = tileSources(pack, mode, topic, base);
  // The foto pack ships AVIF tiles (WebP as fallback); every other pack ships SVG.
  const avif = /\.avif(\?|$)/.test(t.src);
  const css = { ...(height !== undefined ? { "--pack-tile-h": typeof height === "number" ? `${height}px` : height } : null), ...style } as CSSProperties;
  return (
    <span className={`kx-pack-tile${className ? ` ${className}` : ""}`} style={css} aria-hidden data-pack={pack}>
      {avif ? (
        <picture>
          {raster !== key && <source type="image/avif" srcSet={t.src} />}
          <img src={t.webp} alt="" loading="lazy" decoding="async" onError={retry} />
        </picture>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- baked pack SVG, nothing for next/image to optimize */}
          <img src={raster === key ? t.webp : t.src} alt="" loading="lazy" decoding="async" onError={retry} />
        </>
      )}
    </span>
  );
}

/** Tile as a plain image source (small thumbnails, list rows): the cover URL of a topic in the active pack. */
export function useTileSrc(topic: TileTopic): string {
  const { pack, mode, base } = useThemePack();
  return tileSources(pack, mode, topic, base).src;
}
