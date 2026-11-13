"use client";

import { useState } from "react";
import { focusX, fullSources } from "@kortex/theme-packs";
import { effectiveBackdrop } from "@/lib/settings/appearance";
import { useSettings } from "@/lib/settings/store";
import { backdropTopic } from "@/lib/theme/backdrop";
import { useThemePack } from "@/lib/theme/pack";

/**
 * Frame backdrop "Theme-Pack" (Settings > Erscheinungsbild > Rahmen-Hintergrund): one fixed *-full motif of the pack
 * (the same on every route, W3), blurred 26 px and tinted with --lum-0 (tactile.css .tc-backdrop). The canvas stays solid. With the
 * default "Akzent-Glow", or reduced transparency, nothing renders here (the glow is the shell's ::before).
 *
 * Robustness like the former Home hero (F10): an AVIF that cannot be loaded (blocked, corrupt, offline CDN) is
 * retried once as WebP; if that fails too, the backdrop is given up and the frame keeps its plain glow.
 */
export function ShellBackdrop() {
  const { appearance } = useSettings();
  const { pack, ready, mode, base } = useThemePack();
  const [noAvif, setNoAvif] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const topic = backdropTopic();
  const key = `${pack}/${mode}/${topic}`;
  if (effectiveBackdrop(appearance) !== "pack" || !ready || failed === key) return null;
  const src = fullSources(pack, mode, topic, base);
  return (
    <div className="tc-backdrop" aria-hidden data-topic={topic} data-pack={pack}>
      <picture key={key}>
        {noAvif !== key && <source srcSet={src.avif} type="image/avif" />}
        <img
          src={src.webp}
          alt=""
          decoding="async"
          style={{ objectPosition: `${Math.round(focusX(topic) * 100)}% 50%` }}
          onError={() => (noAvif === key ? setFailed(key) : setNoAvif(key))}
        />
      </picture>
    </div>
  );
}
