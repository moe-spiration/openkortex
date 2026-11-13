"use client";

import { t } from "@/i18n";
import type { CSSProperties } from "react";
import { Hash } from "lucide-react";
import { Rail } from "@kortex/ui";
import { Ico } from "@/components/shell/icons";
import { useSmartMixes } from "@/lib/data/home";
import type { BackInCard, HomeTarget, SmartMix } from "@/lib/mock/home";
import { glyphTint, restLabel } from "./home-utils";
import { Img } from "./Img";
import { typeIcon } from "./Thumb";

/**
 * "Weiter, wo Du warst" (Feinschliff Live `.li-c`): compact rows with the tinted type glyph, the title with its
 * progress bar below (or the position line when there is no progress) and what is left; the meta line is the tooltip.
 */
export function JumpBackIn({
  cards,
  go,
  onAll,
  className = "hm-bx",
}: {
  cards: BackInCard[] | null;
  go: (t: HomeTarget) => void;
  onAll?: () => void;
  className?: string;
}) {
  return (
    <section className={className} aria-label={t("Continue where you left off")} aria-busy={!cards}>
      <div className="hm-bx-h">
        <h2 className="e-h2">{t("Continue where you left off")}</h2>
        {onAll && (
          <button type="button" className="e-link" onClick={onAll}>
            {t("All entries")}
          </button>
        )}
      </div>
      {cards && cards.length === 0 ? (
        <p className="e-meta" style={{ margin: 0 }}>
          {t("Nothing started yet. What you read, listen to or edit shows up here again.")}
        </p>
      ) : (
        <div>
          {!cards
            ? [0, 1, 2, 3].map((i) => <span key={i} className="hm-skel" style={{ height: 46, margin: "6px 0" }} aria-hidden />)
            : cards.slice(0, 5).map((c, i) => (
                // Feinschliff Live `.li-c`: tinted type glyph, title with the progress bar below, what is left on the right.
                <button key={`${c.title}-${i}`} type="button" className="fs-home-cont" title={c.meta} onClick={() => go(c.target)}>
                  <span className="fs-home-glyph" style={{ "--gc": glyphTint(c.type) } as CSSProperties} aria-hidden>
                    <Ico name={typeIcon(c.type)} size="sm" />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="hm-cont-t e-clamp1">{c.title}</span>
                    {c.pct !== null ? (
                      <span className="e-pbar fs-home-bar" role="progressbar" aria-label={t("Progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.pct)}>
                        <i style={{ width: `${Math.min(100, Math.max(0, c.pct))}%` }} />
                      </span>
                    ) : (
                      <span className="e-meta e-clamp1" style={{ display: "block" }}>
                        {c.meta}
                      </span>
                    )}
                  </span>
                  <span className="e-meta e-num fs-home-cont-r">{c.pct !== null ? restLabel(c.pct) : ""}</span>
                </button>
              ))}
        </div>
      )}
    </section>
  );
}

/** One mix: a stack of covers (its image plus quiet hashtag tiles) as a chip with name and count. */
function MixChip({ m, onPick }: { m: SmartMix; onPick: (tag: string) => void }) {
  return (
    <button type="button" className="hm-mix" onClick={() => onPick(m.tag)} title={m.tag}>
      <span className="hm-stack" aria-hidden>
        <Img src={m.img} />
        <span className="hm-stack-dot">
          <Hash className="kx-ico" />
        </span>
      </span>
      <span style={{ display: "grid" }}>
        <span className="hm-mix-name">{m.title}</span>
        <span className="e-meta e-num" style={{ fontSize: "calc(11px * var(--kx-fs, 1))" }}>
          {m.count ?? 0} Einträge
        </span>
      </span>
    </button>
  );
}

/** The mixes as a `Rail` (no scrollbar, arrows in the head). `mixes` null = loading. */
export function MixesRail({ mixes, onPick }: { mixes: SmartMix[] | null; onPick: (tag: string) => void }) {
  if (mixes && mixes.length === 0)
    return (
      <section className="hm-mixes-rail" aria-label="Smart Knowledge Mixes">
        <h2 className="e-h2">Smart Knowledge Mixes</h2>
        <p className="e-meta" style={{ margin: "6px 0 0" }}>
          {t("A mix appears as soon as at least two entries share a hashtag.")}
        </p>
      </section>
    );
  return (
    <Rail
      className="hm-mixes-rail"
      title="Smart Knowledge Mixes"
      meta={mixes ? t("{n} mixes · from your hashtags", { n: mixes.length }) : t("Loading…")}
      step={420}
      gap={8}
    >
      {!mixes
        ? [0, 1, 2, 3, 4].map((i) => <span key={i} className="hm-skel" style={{ width: 180, height: 44, flex: "none" }} aria-hidden />)
        : mixes.map((m) => <MixChip key={m.tag} m={m} onPick={onPick} />)}
    </Rail>
  );
}

/**
 * "Smart Knowledge Mixes": auto playlists per hashtag; a chip opens Alle Einträge filtered by its tag.
 * Also rendered by Spaces (views/SpaceView.tsx); keep this export and its props stable.
 */
export function SmartMixes({ pickTag }: { pickTag: (tag: string) => void }) {
  const mixes = useSmartMixes();
  return <MixesRail mixes={mixes} onPick={pickTag} />;
}
