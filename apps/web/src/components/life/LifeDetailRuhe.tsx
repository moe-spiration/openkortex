"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowUpRight, FilePlus2, FileText, Plus, Target } from "lucide-react";
import { TypeIcon } from "@/components/note/icons";
import { ThemeHero } from "@/components/theme/ThemeHero";
import { LocationBar } from "@/components/shell/Bars";
import { MenuItem } from "@/components/ui/primitives";
import { addDays, entryWhen, mondayOf, weekdayIndex } from "@/lib/daily/journal";
import { GRIPLY_APP_URL } from "@/lib/griply";
import { LIFE_PAGE_FOLDER, findLifePage, lifePageTemplate, lifeSubpages, lifeTag } from "@/lib/life/page";
import type { LifeAreaDetail } from "@/lib/mock/life";
import { coverSrc } from "@/lib/mock/views";
import { useNotes } from "@/lib/notes/store";
import { uniqueTitle } from "@/lib/notes/unique-title";
import { lifeHref, noteHrefById } from "@/lib/shell/routes";
import { lifeTopic } from "@/lib/theme/topics";
import { MOCK_TODAY, NOTE_TYPES, isLiveData, noteById } from "@/lib/workspace-data";
import { getGriplyArea, type GriplyAreaView } from "@/server/griply/actions";
import { feature, getLocale, msg, t } from "@/i18n";

/*
 * One Life area in the Ruhe look (2026-11-27, mockup screen "life"): a muted hero behind the location bar
 * "Life › <area>", the area's dot, name and vision sentence, "Ziele aus Griply, nur lesen" with a bar each, "Zuletzt"
 * (the newest entries of the area), and on the right "Diese Woche" (entries of the area per day) and "Notiz" (the area's
 * own page, 10_Notes/Life Areas/<Name>.md, with its subpages). Kortex keeps no goals here: they come from Griply (in
 * mock mode the prototype's goals stand in). Styles: packages/ui/src/styles/ruhe-life.css.
 */

const WD = [msg("M"), msg("T"), msg("W"), msg("T"), msg("F"), msg("S"), msg("S")];

type Goal = { id: string; name: string; pct: number | null; value: string };

/** The page's own text without headings and without the vision sentence: what "Notiz" shows. */
function pageExcerpt(md: string, vision: string): string {
  const text = md
    .split("\n")
    .filter((l) => !/^\s*#/.test(l) && !/^\s*!\[/.test(l))
    .join(" ")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const rest = vision && text.startsWith(vision.trim()) ? text.slice(vision.trim().length).trim() : text;
  return rest.length > 260 ? `${rest.slice(0, 259).trimEnd()}…` : rest;
}

export function LifeDetailRuhe({ area: a, vision, onOpen }: { area: LifeAreaDetail; vision: string; onOpen: (id: string) => void }) {
  const live = isLiveData();
  const today = MOCK_TODAY;
  const { items, createNote, createSubpage } = useNotes();
  const all = useMemo(() => Object.values(items), [items]);
  const page = useMemo(() => findLifePage(all, a.key), [all, a.key]);
  const subpages = useMemo(() => (page ? lifeSubpages(all, page) : []), [all, page]);
  const own = new Set([page?.id, ...subpages.map((s) => s.id)]);
  const linked = a.links
    .map((id) => noteById(id))
    .filter((n): n is NonNullable<ReturnType<typeof noteById>> => n !== undefined && !own.has(n.id))
    .sort((x, y) => (x.date + x.time < y.date + y.time ? 1 : -1));

  // Goals: Griply (live, read only); mock mode shows the prototype's goals in their place.
  const [griply, setGriply] = useState<GriplyAreaView | null>(null);
  const [griplyError, setGriplyError] = useState<string | null>(null);
  useEffect(() => {
    if (!live || !feature("griply")) return;
    let off = false;
    void getGriplyArea(a.key, [a.name]).then((r) => {
      if (off) return;
      if (r.ok) setGriply(r.data);
      else setGriplyError(r.error);
    });
    return () => {
      off = true;
    };
  }, [live, a.key, a.name]);
  const goals: Goal[] = live
    ? [...(griply?.area?.goals ?? []), ...(griply?.area?.projects ?? [])].map((g) => ({ id: g.id, name: g.name, pct: g.progress ?? null, value: g.progress !== undefined ? `${g.progress} %` : "" }))
    : a.goals.map((g, i) => ({ id: `g${i}`, name: g.t, pct: g.pct, value: `${g.pct} %` }));
  const griplyState = !live ? "connected" : griply?.state ?? (griplyError ? "error" : "loading");

  // "Diese Woche": entries of the area per day of the current week.
  const monday = mondayOf(today);
  const perDay = WD.map((_, i) => linked.filter((n) => n.date === addDays(monday, i)).length);
  const max = Math.max(1, ...perDay);
  const todayIdx = weekdayIndex(today);

  const createPage = () => {
    if (page) return;
    createNote({ title: a.name, contentMd: lifePageTemplate(vision, getLocale()), folder: LIFE_PAGE_FOLDER, tags: [lifeTag(a.key)] });
  };
  const addSubpage = () => {
    if (!page) return;
    onOpen(createSubpage(page.id, uniqueTitle(t("New subpage"), all.map((i) => i.title))).id);
  };
  const excerpt = page ? pageExcerpt(page.contentMd ?? "", vision) : "";
  const topic = lifeTopic(a.key);

  return (
    <div className="rz-lf" style={{ "--lf-dot": `var(--tag-${a.tone}-dot)` } as CSSProperties}>
      <div className="rz-lf-hero" aria-hidden>
        <span className="rz-lf-hero-img" style={{ backgroundImage: `url(${coverSrc(a.img)})` }} />
        {topic && <ThemeHero topic={topic} />}
        <span className="rz-lf-hero-fade" />
      </div>
      <LocationBar
        icon="life"
        crumbs={[{ label: "Life", href: lifeHref("overview") }, { label: a.name }]}
        actions={
          feature("griply") ? (
            <a href={GRIPLY_APP_URL} target="_blank" rel="noreferrer noopener" className="rz-bbtn rz-bbtn--ghost">
              <Target aria-hidden size={14} strokeWidth={1.75} />
              {t("Goals in Griply")}
              <ArrowUpRight aria-hidden size={12} strokeWidth={1.75} />
            </a>
          ) : undefined
        }
        more={
          <>
            {page ? (
              <MenuItem onSelect={() => onOpen(page.id)}>
                <FileText aria-hidden size={14} strokeWidth={1.75} />
                {t("Open as page")}
              </MenuItem>
            ) : (
              <MenuItem onSelect={createPage}>
                <FilePlus2 aria-hidden size={14} strokeWidth={1.75} />
                {t("Create page")}
              </MenuItem>
            )}
            {page && (
              <MenuItem onSelect={addSubpage}>
                <Plus aria-hidden size={14} strokeWidth={1.75} />
                {t("New subpage")}
              </MenuItem>
            )}
          </>
        }
      />

      <div className="rz-lf-body">
        <div className="rz-lf-main">
          <h1 className="rz-lf-title">
            <span className="rz-lf-dot" aria-hidden />
            {a.name}
          </h1>
          <p className="rz-lf-vision">{vision || a.focus || t("No vision yet.")}</p>

          {feature("griply") && (
            <section aria-label={t("Goals")}>
              <h2 className="rz-lf-h2">
                {t("Goals")} <span>{t("from Griply, read only")}</span>
              </h2>
              {griplyState === "loading" ? (
                <p className="rz-lf-none">{t("Loading")}</p>
              ) : griplyState === "error" ? (
                <p className="rz-lf-none">{griplyError}</p>
              ) : griplyState !== "connected" ? (
                <p className="rz-lf-none">
                  {t("Goals, projects and habits of this area live in Griply.")}{" "}
                  <Link href="/settings?section=connectors" className="rz-link">
                    {t("Connect Griply")}
                  </Link>
                </p>
              ) : goals.length ? (
                goals.map((g) => (
                  <div key={g.id} className="rz-lf-goal">
                    <span className="rz-lf-goal-t">{g.name}</span>
                    <span className="rz-lf-bar" role="progressbar" aria-label={g.name} aria-valuenow={g.pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                      <i style={{ width: `${Math.max(0, Math.min(100, g.pct ?? 0))}%` }} />
                    </span>
                    <span className="rz-lf-goal-v">{g.value}</span>
                  </div>
                ))
              ) : (
                <p className="rz-lf-none">{t("“{name}” has no open goals in Griply.", { name: a.name })}</p>
              )}
            </section>
          )}

          <section aria-label={t("Recently")}>
            <h2 className="rz-lf-h2 rz-lf-h2--gap">{t("Recently")}</h2>
            {linked.length ? (
              linked.slice(0, 6).map((n) => (
                <button key={n.id} type="button" className="rz-lf-row" onClick={() => onOpen(n.id)} title={n.title}>
                  <TypeIcon type={n.type} size={14} />
                  <span className="rz-lf-row-t">{n.title}</span>
                  <span className="rz-lf-row-s">{n.tldr || NOTE_TYPES[n.type].label}</span>
                  <span className="rz-lf-row-r">{entryWhen(n.date, "", today)}</span>
                </button>
              ))
            ) : (
              <p className="rz-lf-none">{t("No entries yet. Notes, articles and meetings with #life/{key} or matching tags land here.", { key: a.key })}</p>
            )}
          </section>
        </div>

        <aside className="rz-lf-aside">
          <h2 className="rz-lf-lab">{t("This week")}</h2>
          <div className="rz-lf-week" role="img" aria-label={t("Entries of this area per day this week")}>
            {perDay.map((n, i) => (
              <span key={i} className={i === todayIdx ? "is-today" : undefined}>
                <i style={{ height: n ? `${Math.round((n / max) * 70) + 6}px` : "3px" }} />
                <b>{t(WD[i]!)}</b>
              </span>
            ))}
          </div>
          <p className="rz-lf-cap">{t("Entries per day from this area")}</p>

          <h2 className="rz-lf-lab rz-lf-lab--gap">{t("Note")}</h2>
          {page ? (
            <>
              <p className="rz-lf-note">{excerpt || t("The page is still empty.")}</p>
              <Link href={noteHrefById(page.id)} className="rz-link rz-lf-more">
                {t("Open as page")}
              </Link>
              {subpages.length > 0 && (
                <div className="rz-lf-subs">
                  {subpages.map((n) => (
                    <button key={n.id} type="button" className="rz-lf-sub" onClick={() => onOpen(n.id)}>
                      <FileText aria-hidden size={13} strokeWidth={1.75} />
                      <span>{n.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="rz-lf-note">{t("{name} gets its own page in your vault: vision, ideas, images and notes, written in the normal editor.", { name: a.name })}</p>
              <button type="button" className="rz-btn rz-lf-create" onClick={createPage}>
                <FilePlus2 aria-hidden size={14} strokeWidth={1.75} />
                {t("Create page")}
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
