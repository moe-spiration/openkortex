"use client";

import { Layers } from "lucide-react";
import { useSmartMixes } from "@/lib/data/home";
import { tagTone } from "@/lib/workspace-data";
import { useLook } from "@/components/theme/look";
import { EntryPlaceholder, ownImage } from "./EntryParts";
import type { ViewEntry } from "./entries";
import { t, tn } from "@/i18n";
import { EmptyPic } from "@/components/motion/EmptyPic";

/*
 * Smart Knowledge Mixes of the collections (Feinschliff Live, prototype `.mixes` / `.mtile`): header with the mix
 * count, then a row of mini tiles with a three-image collage (the mix's own entries: their covers first, then the mix
 * artwork, then the monochrome placeholders of entries without an image), name and count. A click filters the collection by the
 * mix's hashtag (the tile turns on); a second click clears it.
 */

const bare = (tag: string) => tag.replace(/^#/, "").toLowerCase();
const inMix = (tag: string, mix: string) => {
  const own = bare(tag);
  const m = bare(mix);
  return own === m || own.startsWith(m + "/");
};

export function MixesRail({ entries, active, onPick }: { entries: readonly ViewEntry[]; active?: string | null; onPick: (tag: string) => void }) {
  const mixes = useSmartMixes();
  const ruhe = useLook() === "ruhe";
  if (mixes === null) {
    return (
      <div aria-busy="true" className="kc-mixes-wrap">
        <span className="kc-empty-line">{t("Loading mixes …")}</span>
      </div>
    );
  }
  if (mixes.length === 0) {
    return (
      <div className="kc-mixes-wrap">
        <EmptyPic
          kind="idea"
          size="sm"
          classic={
            <span className="kc-empty-line">
              <Layers aria-hidden />
              {t("No mixes yet: a mix emerges as soon as two entries carry the same hashtag.")}
            </span>
          }
        >
          {t("No mixes yet: a mix emerges as soon as two entries carry the same hashtag.")}
        </EmptyPic>
      </div>
    );
  }
  return (
    <section className="kc-mixes-wrap" aria-label="Smart Knowledge Mixes">
      <div className="kc-mixes-h">
        <h2 className="kc-h2">Smart Knowledge Mixes</h2>
        <span className="kc-meta">
          {tn(mixes.length, "{n} mix · from your hashtags", "{n} mixes · from your hashtags")}
        </span>
      </div>
      <div className="kc-mixes">
        {mixes.map((m) => {
          const own = entries.filter((e) => e.tags.some((x) => inMix(x.label, m.tag)));
          const count = m.count ?? own.length;
          const imgs: string[] = [];
          const add = (src: string | null | undefined) => {
            if (src && imgs.length < 3 && !imgs.includes(src)) imgs.push(src);
          };
          for (const e of own) add(ownImage(e.cover));
          add(m.img);
          // Too few images: monochrome placeholders of the mix entries fill the collage (decision 13: no pack tiles).
          const fill = own.filter((e) => !ownImage(e.cover)).slice(0, Math.max(0, 3 - imgs.length));
          const on = !!active && bare(active) === bare(m.tag);
          return (
            <button key={m.tag} type="button" className={"kc-mtile" + (on ? " is-on" : "")} aria-pressed={on} onClick={() => onPick(m.tag)} title={m.tag}>
              <span className={"kc-coll kc-coll--" + Math.max(1, imgs.length + fill.length)} aria-hidden>
                {imgs.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element -- entry covers from arbitrary hosts
                  <img key={src} src={src} alt="" loading="lazy" decoding="async" />
                ))}
                {fill.map((e) => (
                  <span key={e.id} className="kc-coll-ph">
                    <EntryPlaceholder kind={e.kind} size={14} />
                  </span>
                ))}
              </span>
              <span className="kc-mtile-t">
                <b>{m.title}</b>
                <span>
                  {ruhe && <i className="kc-mtile-dot" aria-hidden style={{ background: `var(--tag-${tagTone(m.tag)}-dot)` }} />}
                  {tn(count, "{n} entry", "{n} entries")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
