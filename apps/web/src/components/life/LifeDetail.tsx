"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import { Img } from "@/components/home/Img";
import { NoteBody } from "@/components/note/NoteBody";
import { TypeIcon } from "@/components/note/icons";
import { Ico } from "@/components/shell/icons";
import { ThemeHero } from "@/components/theme/ThemeHero";
import { LIFE_PAGE_FOLDER, findLifePage, lifePageTemplate, lifeSubpages, lifeTag } from "@/lib/life/page";
import type { LifeAreaDetail } from "@/lib/mock/life";
import { coverSrc } from "@/lib/mock/views";
import { useNotes } from "@/lib/notes/store";
import { uniqueTitle } from "@/lib/notes/unique-title";
import { noteHrefById } from "@/lib/shell/routes";
import { lifeTopic } from "@/lib/theme/topics";
import { NOTE_TYPES, noteById } from "@/lib/workspace-data";
import { GriplyPanel } from "./GriplyPanel";
import { LIco } from "./icons";
import { feature, getLocale, t, tn } from "@/i18n";

/**
 * One Life Area as a page: the hero, then the area's own note in the normal editor (vision, ideas, images;
 * 10_Notes/Life Areas/<Name>.md, lib/life/page.ts) and a rail with the goals in Griply (read only), the
 * subpages and the entries of the vault that belong to the area. Kortex keeps no goals, habits or scores here.
 */
export function LifeDetail({
  area: a,
  vision,
  onBack,
  onOpen,
}: {
  area: LifeAreaDetail;
  /** The vision saved before areas were pages: the first text of a new page. */
  vision: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const { items, createNote, createSubpage } = useNotes();
  const all = useMemo(() => Object.values(items), [items]);
  const page = useMemo(() => findLifePage(all, a.key), [all, a.key]);
  const subpages = useMemo(() => (page ? lifeSubpages(all, page) : []), [all, page]);
  const own = new Set([page?.id, ...subpages.map((s) => s.id)]);
  const linked = a.links.map((id) => noteById(id)).filter((n) => n !== undefined && !own.has(n.id)) as NonNullable<ReturnType<typeof noteById>>[];

  const createPage = () => {
    if (page) return;
    createNote({ title: a.name, contentMd: lifePageTemplate(vision, getLocale()), folder: LIFE_PAGE_FOLDER, tags: [lifeTag(a.key)] });
  };
  const addSubpage = () => {
    if (!page) return;
    onOpen(createSubpage(page.id, uniqueTitle(t("New subpage"), all.map((i) => i.title))).id);
  };

  return (
    <div className="lf-detail" style={{ position: "relative" }}>
      <div className="kx-hero" style={{ height: 300 }}>
        {lifeTopic(a.key) ? (
          <ThemeHero topic={lifeTopic(a.key)!} />
        ) : (
          <>
            <Img className="kx-hero-img kx-hero-img--full" src={coverSrc(a.img)} />
            <span
              className="kx-hero-fade kx-hero-fade--top"
              style={{ "--hero-h": "100%", "--hero-bg": "var(--bg-main-window)" } as CSSProperties}
              aria-hidden
            />
          </>
        )}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            maxWidth: 1120,
            margin: "0 auto",
            padding: "0 32px 18px",
            display: "grid",
            gap: 8,
          }}
        >
          <button
            type="button"
            className="kx-btn kx-btn--ghost kx-btn--sm"
            style={{ width: "fit-content", minHeight: 32, background: "var(--glass-strong)", boxShadow: "var(--edge-raised)", WebkitBackdropFilter: "blur(14px)", backdropFilter: "blur(14px)" }}
            onClick={onBack}
          >
            <LIco name="l" />
            {t("All areas")}
          </button>
          <span className="kx-eyebrow">Life Area</span>
          <h1 className="kx-h-display" style={{ margin: 0 }}>
            {a.name}
          </h1>
        </div>
      </div>

      <div className="lf-page">
        <div className="lf-page-main">
          {page ? (
            <>
              <div className="lf-page-path">
                <span className="kx-mono">{page.path}</span>
                <Link href={noteHrefById(page.id)} className="jr-sig-more">
                  {t("Open as page")}
                </Link>
              </div>
              <div className="fs-ed lf-page-ed" data-note-content data-type="note">
                <div className="kx-dr-read fs-ed-read">
                  <NoteBody key={page.id} item={page} />
                </div>
              </div>
            </>
          ) : (
            <section className="lf-panel lf-page-empty">
              {vision && <p className="kx-h-section" style={{ margin: 0 }}>{t("“{vision}”", { vision })}</p>}
              <p className="kx-body" style={{ margin: 0, color: "var(--text-secondary)" }}>
                {t("{name} gets its own page in your vault: vision, ideas, images and notes, written in the normal editor.", { name: a.name })}
              </p>
              <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" style={{ width: "fit-content" }} onClick={createPage}>
                <LIco name="edit" />
                {t("Create page")}
              </button>
            </section>
          )}
        </div>

        <aside className="lf-page-rail">
          {feature("griply") && <GriplyPanel areaKey={a.key} areaName={a.name} />}

          <section className="lf-panel">
            <span className="kx-eyebrow">{t("Subpages")}</span>
            {subpages.map((n) => (
              <button key={n.id} type="button" className="lf-page-row" onClick={() => onOpen(n.id)}>
                <Ico name="file-text" size="sm" />
                <span className="kx-truncate">{n.title}</span>
              </button>
            ))}
            <button type="button" className="lf-page-row lf-page-row--add" disabled={!page} onClick={addSubpage} title={page ? undefined : t("Create the page first")}>
              <Ico name="plus" size="sm" />
              <span>{t("New subpage")}</span>
            </button>
          </section>

          <section className="lf-panel">
            <div className="kxh-row">
              <span className="kx-eyebrow">{t("From the vault")}</span>
              <span className="kx-num" style={{ marginLeft: "auto", fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-muted)" }}>
                {tn(linked.length, "{n} entry", "{n} entries")}
              </span>
            </div>
            {linked.length === 0 && <span className="kx-help">{t("No entries yet. Notes, articles and meetings with #life/{key} or matching tags land here.", { key: a.key })}</span>}
            {linked.map((n) => (
              <button key={n.id} type="button" className="lf-page-row" onClick={() => onOpen(n.id)} title={n.title}>
                <TypeIcon type={n.type} size={14} />
                <span className="kx-truncate">{n.title}</span>
                <span className="kx-meta">{NOTE_TYPES[n.type].label}</span>
              </button>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
