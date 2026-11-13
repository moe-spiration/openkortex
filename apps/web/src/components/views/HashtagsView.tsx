"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, Hash, Search } from "lucide-react";
import { DensitySwitch } from "@kortex/ui";
import { useShell } from "@/lib/shell/store";
import { useDensity } from "@/lib/settings/store";
import { spaceHref } from "@/lib/shell/routes";
import { collectionScope, filterTags, sparkPath, type TagGroup } from "@/lib/data/collections";
import { CollectionHead } from "./CollectionHead";
import { Avatars } from "./EntryParts";
import type { EntryObject } from "./entries";
import { t, tn } from "@/i18n";

/*
 * Hashtags (Tactile Craft v2, dummy `Hashtags`): dense hierarchical index (#pfad/teil) with count, share bar, a 30-day
 * sparkline from the entries' real timestamps and linked objects; groups fold in and out, inline filter, density.
 */

function Spark({ series, w = 90, h = 22 }: { series: number[]; w?: number; h?: number }) {
  const p = useMemo(() => sparkPath(series, w, h), [series, w, h]);
  const total = series.reduce((a, b) => a + b, 0);
  return (
    <svg className="kc-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("{n} in 30 days", { n: total })}>
      <path d={p.area} fill="var(--accent-soft)" stroke="none" />
      <path d={p.line} fill="none" stroke="var(--t3)" strokeWidth={1.25} />
      <circle cx={p.last[0]} cy={p.last[1]} r={2.2} fill="var(--accent)" />
    </svg>
  );
}

export function HashtagsView({
  groups,
  objects,
  entryCount,
}: {
  groups: TagGroup[];
  objects: Record<string, EntryObject>;
  entryCount: number;
}) {
  const { drawer } = useShell();
  const { density, setDensity } = useDensity(collectionScope("hashtags"), { drawerOpen: drawer.id !== null });
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const shown = useMemo(() => filterTags(groups, q), [groups, q]);
  const max = Math.max(1, ...groups.map((g) => g.count));
  const tagTotal = groups.reduce((n, g) => n + 1 + g.children.length, 0);
  const objs = (ids: string[]) => ids.map((id) => objects[id]).filter((o): o is EntryObject => !!o);
  const toggle = (tag: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(tag)) n.delete(tag);
      else n.add(tag);
      return n;
    });

  return (
    <div className="kc-page" data-density={density} data-collection="hashtags">
      <CollectionHead
        icon={<Hash aria-hidden />}
        crumbs={[{ label: t("Knowledge") }, { label: "Hashtags" }]}
        title="Hashtags"
        stats={[
          { value: entryCount, label: tn(entryCount, "entry", "entries") },
          { value: tagTotal, label: tn(groups.length, "tags in {n} area", "tags in {n} areas") },
        ]}
        aside={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <DensitySwitch value={density} onChange={setDensity} />
            <label className="kc-search">
              <Search aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filter tags …")} aria-label={t("Filter tags")} />
            </label>
          </span>
        }
      />

      <div className="kc-ht" role="table" aria-label={t("Hashtag index")}>
        <div className="kc-htrow is-head" role="row">
          <span role="columnheader">Tag</span>
          <span role="columnheader" style={{ textAlign: "right" }}>
            {t("Count")}
          </span>
          <span role="columnheader" className="kc-hide-s">
            {t("Share")}
          </span>
          <span role="columnheader">{t("{n} days", { n: 30 })}</span>
          <span role="columnheader" className="kc-hide-s">
            {t("Objects")}
          </span>
        </div>
        {shown.length === 0 && <div className="kc-section kc-empty-line">{groups.length ? t("No tag matches this filter.") : t("No hashtags yet. Kortex assigns them while sorting.")}</div>}
        {shown.map((g) => {
          const open = !closed.has(g.tag) || !!q;
          return (
            <div key={g.tag} role="rowgroup">
              <div className="kc-htrow" role="row" style={{ fontWeight: 500 }}>
                <span className="kc-ht-name" role="cell">
                  {g.children.length > 0 ? (
                    <button type="button" className="kc-ht-tog" aria-expanded={open} aria-label={open ? t("Collapse #{tag}", { tag: g.tag }) : t("Expand #{tag}", { tag: g.tag })} onClick={() => toggle(g.tag)}>
                      <ChevronDown aria-hidden />
                    </button>
                  ) : (
                    <span style={{ width: 18 }} aria-hidden />
                  )}
                  <Link href={spaceHref("all", "#" + g.tag)}>
                    <span className="kc-t3">#</span>
                    {g.tag}
                  </Link>
                </span>
                <span className="kc-num" role="cell" style={{ textAlign: "right" }}>
                  {g.count}
                </span>
                <span className="kc-htbar kc-hide-s" role="cell" aria-hidden>
                  <i style={{ width: `${(g.count / max) * 100}%` }} />
                </span>
                <span role="cell">
                  <Spark series={g.series} />
                </span>
                <span className="kc-hide-s" role="cell">
                  <Avatars objects={objs(g.objects)} />
                </span>
              </div>
              {open &&
                g.children.map((k) => (
                  <div key={k.tag} className="kc-htrow is-child" role="row">
                    <span className="kc-ht-name" role="cell" style={{ paddingLeft: 24 }}>
                      <Link href={spaceHref("all", "#" + k.tag)}>
                        <span className="kc-t3">#{g.tag}/</span>
                        {k.name}
                      </Link>
                    </span>
                    <span className="kc-num" role="cell" style={{ textAlign: "right" }}>
                      {k.count}
                    </span>
                    <span className="kc-htbar kc-hide-s" role="cell" aria-hidden>
                      <i style={{ width: `${(k.count / max) * 100}%` }} />
                    </span>
                    <span role="cell">
                      <Spark series={k.series} />
                    </span>
                    <span className="kc-hide-s" role="cell">
                      <Avatars objects={objs(k.objects)} />
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
