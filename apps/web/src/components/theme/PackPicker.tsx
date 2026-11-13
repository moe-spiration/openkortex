"use client";

import { PACK_IDS, PACK_LABELS, fullSources, tileSources, type PackId } from "@kortex/theme-packs";
import { useThemePack } from "@/lib/theme/pack";
import { t } from "@/i18n";

/**
 * Pack selection for Settings, next to the accent colour: one card per pack with a preview (home background
 * plus two tiles) in the current light/dark mode. The change is saved with the user settings and applies at once.
 */
export function PackPicker() {
  const { pack, mode, base, setPack } = useThemePack();
  return (
    <div className="kx-packpick" role="radiogroup" aria-label={t("Theme pack")}>
      {PACK_IDS.map((id: PackId) => {
        const on = id === pack;
        const home = fullSources(id, mode, "home", base);
        const a = tileSources(id, mode, "health", base);
        const b = tileSources(id, mode, "notes", base);
        const avif = (s: string) => /\.avif(\?|$)/.test(s);
        return (
          <button key={id} type="button" className="kx-packcard" role="radio" aria-checked={on} onClick={() => setPack(id)}>
            <span className="kx-packcard-prev" aria-hidden>
              <picture>
                <source type="image/avif" srcSet={home.avif} />
                <img src={home.webp} alt="" loading="lazy" decoding="async" />
              </picture>
            </span>
            <span className="kx-packcard-tiles" aria-hidden>
              {[a, b].map((tile, i) => (
                <span key={i}>
                  {avif(tile.src) ? (
                    <picture>
                      <source type="image/avif" srcSet={tile.src} />
                      <img src={tile.webp} alt="" loading="lazy" decoding="async" />
                    </picture>
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- baked pack SVG, nothing for next/image to optimize */}
                      <img src={tile.src} alt="" loading="lazy" decoding="async" />
                    </>
                  )}
                </span>
              ))}
            </span>
            <strong className="kx-body" style={{ fontWeight: 500 }}>
              {PACK_LABELS[id]}
            </strong>
          </button>
        );
      })}
    </div>
  );
}
