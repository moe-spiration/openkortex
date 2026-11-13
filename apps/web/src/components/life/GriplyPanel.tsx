"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { GRIPLY_APP_URL, type GriplyItem } from "@/lib/griply";
import { isLiveData } from "@/lib/workspace-data";
import { getGriplyArea, type GriplyAreaView } from "@/server/griply/actions";
import { intlLocale, t } from "@/i18n";

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(intlLocale(), { day: "numeric", month: "short", year: "numeric" });

function Items({ label, items }: { label: string; items: GriplyItem[] }) {
  if (!items.length) return null;
  return (
    <>
      <span className="kx-label">{label}</span>
      {items.map((g) => (
        <div key={g.id} className="lf-gr-row" title={g.name}>
          <span className="lf-gr-name">{g.name}</span>
          <span className="kx-meta">
            {[g.progress !== undefined ? `${g.progress} %` : null, g.deadline ? t("until {date}", { date: day(g.deadline) }) : null].filter(Boolean).join(" · ")}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * "Ziele in Griply" on a life area's page: the goals, projects and habits Griply holds for the area,
 * read only. Without a connection it says where to connect. Kortex stores none of it.
 */
export function GriplyPanel({ areaKey, areaName }: { areaKey: string; areaName: string }) {
  const live = isLiveData();
  const [view, setView] = useState<GriplyAreaView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let off = false;
    setView(null);
    setError(null);
    void getGriplyArea(areaKey, [areaName]).then((r) => {
      if (off) return;
      if (r.ok) setView(r.data);
      else setError(r.error);
    });
    return () => {
      off = true;
    };
  }, [live, areaKey, areaName]);

  const area = view?.area ?? null;
  const connected = view?.state === "connected";
  const empty = area && !area.goals.length && !area.projects.length && !area.habits.length;
  return (
    <section className="lf-panel" data-testid="griply-panel">
      <div className="kxh-row">
        <span className="kx-eyebrow">{t("Goals in Griply")}</span>
        <span className="kx-meta" style={{ marginLeft: "auto" }}>{t("read only")}</span>
      </div>
      {live && !view && !error ? (
        <span className="kx-help">{t("Loading")}</span>
      ) : error ? (
        <span className="kx-help kx-help--error">{error}</span>
      ) : !connected ? (
        <p className="kx-meta" style={{ margin: 0, lineHeight: 1.5 }}>
          {t("Goals, projects and habits of this area live in Griply. Kortex only shows them and tracks no scores of its own.")}{" "}
          {live && t("Connect Griply to see them here.")}
        </p>
      ) : !area ? (
        <span className="kx-help">{t("Griply has no life area that matches “{name}”.", { name: areaName })}</span>
      ) : empty ? (
        <span className="kx-help">{t("“{name}” has no open goals in Griply.", { name: area.name })}</span>
      ) : (
        <>
          <Items label={t("Goals")} items={area.goals} />
          <Items label={t("Projects")} items={area.projects} />
          {area.habits.length > 0 && (
            <>
              <span className="kx-label">{t("Habits")}</span>
              {area.habits.map((h) => (
                <div key={h.id} className="lf-gr-row" title={h.name}>
                  <span className="lf-gr-name">{h.name}</span>
                  {h.rate !== undefined && <span className="kx-meta">{t("{rate} % in 4 weeks", { rate: h.rate })}</span>}
                </div>
              ))}
            </>
          )}
        </>
      )}
      <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <a href={GRIPLY_APP_URL} target="_blank" rel="noreferrer" className="kx-btn kx-btn--secondary kx-btn--sm" style={{ width: "fit-content" }}>
          {t("Open Griply")}
          <Ico name="up-right" size="sm" />
        </a>
        {live && view && !connected && (
          <Link href="/settings?section=connectors" className="kx-btn kx-btn--ghost kx-btn--sm">
            {t("Connect")}
          </Link>
        )}
      </div>
    </section>
  );
}
