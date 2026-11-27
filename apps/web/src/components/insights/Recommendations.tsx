"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Rail } from "@kortex/ui";
import { Img } from "@/components/home/Img";
import {
  REC_CATS,
  REC_CATS_VISIBLE,
  REC_ICON_COLOR,
  type InsightsData,
  type LeadTheme,
  type RecCategory,
  type RecFilter,
  type Recommendation,
} from "@/lib/mock/insights";
import { coverSrc } from "@/lib/mock/views";
import { InIco, type InIconId } from "./icons";
import { msg, t } from "@/i18n";
import { Pictogram } from "@/components/motion/Pictogram";

/** UI labels of the filter chips and the kind eyebrow; the mock tables only supply keys and icons. */
const CAT_LABEL: Record<RecFilter, string> = {
  all: msg("All"),
  books: msg("Books"),
  podcasts: msg("Podcasts"),
  meetings: msg("Meeting prep"),
  personal: msg("Personal development"),
  deep: msg("Deeper topics"),
  links: msg("Connections"),
  gaps: msg("Knowledge gaps"),
};
const KIND_LABEL: Record<RecCategory, string> = {
  books: msg("Book"),
  podcasts: msg("Podcast"),
  meetings: msg("Meeting prep"),
  personal: msg("Personal development"),
  links: msg("Connection"),
  gaps: msg("Knowledge gap"),
};

const card: CSSProperties = {
  background: "var(--kx-panel-bg, var(--lum-2))",
  boxShadow: "var(--kx-panel-edge, var(--edge-surface))",
};

export interface RecState {
  cat: RecFilter;
  done: Record<string, boolean>;
  later: Record<string, boolean>;
  hero: boolean;
}

export interface RecHandlers {
  setCat: (c: RecFilter) => void;
  act: (r: Recommendation) => void;
  later: (r: Recommendation) => void;
  more: (r: Recommendation) => void;
  heroAct: () => void;
  heroGraph: () => void;
  resetLater: () => void;
}

const iconOf = (r: Recommendation): InIconId =>
  r.icon ?? (r.cover?.kind === "book" ? "in-book" : "in-pod");
const isDone = (r: Recommendation, s: RecState) => !!s.done[r.k] && !r.fn;
/** Number shown in a category chip. */
const catCount = (key: RecFilter, s: RecState, d: InsightsData) => {
  const notLater = d.recommendations.filter((r) => !s.later[r.k]);
  const lead = d.lead ? 1 : 0;
  if (key === "all") return notLater.length + lead; // + lead theme
  if (key === "deep") return lead;
  return notLater.filter((r) => r.cat === key).length;
};

/** V2-08b: "Alle" + the three most used categories as chips (no icons), the rest in "Mehr +n". */
function CategoryFilter({ d, s, h }: { d: InsightsData; s: RecState; h: RecHandlers }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = REC_CATS.filter(([k]) => REC_CATS_VISIBLE.includes(k));
  const more = REC_CATS.filter(([k]) => !REC_CATS_VISIBLE.includes(k));
  const activeMore = more.find(([k]) => k === s.cat);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = (n: number | string) => (
    <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "inherit" }}>
      {n}
    </span>
  );

  return (
    <div ref={ref} className="kxh-wrap" role="group" aria-label={t("Category")} style={{ gap: 4 }}>
      {visible.map(([key]) => (
        <button
          key={key}
          type="button"
          className={"kx-filterchip" + (s.cat === key ? " is-active" : "")}
          aria-pressed={s.cat === key}
          onClick={() => h.setCat(key)}
          style={{ height: 32 }}
        >
          {t(CAT_LABEL[key])}
          {count(catCount(key, s, d))}
        </button>
      ))}
      <span style={{ position: "relative" }}>
        <button
          type="button"
          className={"kx-filterchip" + (activeMore ? " is-active" : "")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{ height: 32 }}
        >
          {activeMore ? t(CAT_LABEL[activeMore[0]]) : t("More")}
          {count(activeMore ? catCount(activeMore[0], s, d) : `+${more.length}`)}
        </button>
        {open && (
          <div
            className="kx-menu"
            role="menu"
            aria-label={t("More categories")}
            style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30 }}
          >
            {more.map(([key]) => (
              <button
                key={key}
                type="button"
                role="menuitemradio"
                aria-checked={s.cat === key}
                className={"kx-menu-item" + (s.cat === key ? " is-selected" : "")}
                style={{
                  width: "100%",
                  border: 0,
                  background: s.cat === key ? undefined : "transparent",
                  textAlign: "left",
                }}
                onClick={() => {
                  h.setCat(key);
                  setOpen(false);
                }}
              >
                <span className="kxh-grow">{t(CAT_LABEL[key])}</span>
                <span className="kx-hint">{catCount(key, s, d)}</span>
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

const gradient = (r: Recommendation) =>
  `linear-gradient(150deg,${r.cover?.c1 ?? "#333"} 0%,${r.cover?.c2 ?? "#555"} 100%)`;

function Cta({
  r,
  s,
  h,
  sm = true,
}: {
  r: Recommendation;
  s: RecState;
  h: RecHandlers;
  sm?: boolean;
}) {
  return isDone(r, s) ? (
    <span className="kx-status kx-status--done">{r.doneLabel ?? t("Done")}</span>
  ) : (
    <button
      type="button"
      className={"kx-btn kx-btn--secondary" + (sm ? " kx-btn--sm" : "")}
      onClick={() => h.act(r)}
    >
      {r.cta}
    </button>
  );
}

/** "Empfehlungen und Inspirationen": category chips, then bento (Alle), lead theme (Tiefere Themen) or a card grid. */
/** Why the section is empty (live data before the first impulses). */
function emptyText(d: InsightsData): [string, string] {
  if (d.impulses === "too_little")
    return [
      t("Too little in the vault so far"),
      t("Once there are at least five entries from the last 30 days, Kortex creates impulses here every day: books, podcasts, meeting preparation and connections."),
    ];
  if (d.impulses === "none" || d.impulses === "stale")
    return [
      t("Impulses are being created"),
      t("Kortex is reading your last 30 days. This takes a few seconds."),
    ];
  return [t("No impulses yet"), t("New impulses arrive tomorrow morning at 06:00.")];
}

export function Recommendations({ d, s, h }: { d: InsightsData; s: RecState; h: RecHandlers }) {
  const all = d.recommendations;
  const visible = all.filter((r) => !s.later[r.k] && (s.cat === "all" || r.cat === s.cat));
  const notLater = all.filter((r) => !s.later[r.k]);
  const top3 = d.top
    .map((k) => all.find((r) => r.k === k))
    .filter((r): r is Recommendation => r !== undefined);
  const rest = visible.filter((r) => !d.top.includes(r.k));
  const nothing = all.length === 0 && !d.lead;
  const [emptyTitle, emptyBody] = emptyText(d);

  return (
    <section
      aria-label={t("Recommendations and inspirations")}
      style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14, minWidth: 0 }}
    >
      <div
        className="kxh-row"
        style={{ flexWrap: "wrap", gap: "10px 16px", alignItems: "flex-end" }}
      >
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <div className="kxh-row" style={{ gap: 8 }}>
            <InIco name="in-spark" style={{ color: "var(--accent-ai)" }} />
            <h2 className="kx-h-section" style={{ margin: 0 }}>
              {t("Recommendations and inspirations")}
            </h2>
          </div>
          <p className="kx-body kx-muted" style={{ margin: "4px 0 0" }}>
            {d.basis}
          </p>
        </div>
      </div>
      {!nothing && <CategoryFilter d={d} s={s} h={h} />}

      {nothing && (
        <div className="kx-emptystate kx-in" role="status">
          <Pictogram kind="idea" size="lg" className="kx-art-ruhe" />
          <strong className="kx-h-section">{emptyTitle}</strong>
          <span className="kx-meta">{emptyBody}</span>
        </div>
      )}

      {!nothing &&
        s.cat === "deep" &&
        (d.lead ? (
          <LeadThemeFull lead={d.lead} s={s} h={h} />
        ) : (
          <div className="kx-emptystate kx-in">
            <Pictogram kind="search" size="lg" className="kx-art-ruhe" />
            <strong className="kx-h-section">{t("No lead theme yet")}</strong>
            <span className="kx-meta">
              {t("A lead theme emerges as soon as a tag occurs at least three times in the last 30 days.")}
            </span>
          </div>
        ))}

      {!nothing && s.cat === "all" && (
        <>
          {/* Layout in CSS (ruhe-split.css): beside each other when the pane is wide, stacked when it is narrow. */}
          <div className="kx-rec-top" data-two={d.lead && top3.length ? "" : undefined}>
            {d.lead && (
              <article
                style={{
                  ...card,
                  position: "relative",
                  display: "grid",
                  alignContent: "end",
                  minHeight: 312,
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                <Img
                  className="kx-photo"
                  src={coverSrc(d.lead.img)}
                  style={{ position: "absolute", inset: 0, opacity: 0.9 }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--bg-surface-flat) 70%, transparent) 45%, var(--bg-surface-flat) 85%)",
                  }}
                />
                <div
                  style={{ position: "relative", padding: "20px 22px", display: "grid", gap: 8 }}
                >
                  <span
                    className="kxh-row kx-eyebrow"
                    style={{ gap: 6, color: "var(--tag-ai-fg)" }}
                  >
                    <InIco name="in-layers" sm />
                    {t("Lead theme of the week")}
                  </span>
                  <h3 className="kx-h-page" style={{ margin: 0 }}>
                    {d.lead.title}
                  </h3>
                  <p
                    className="kx-clamp2 kx-body"
                    style={{
                      margin: 0,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {d.lead.short}
                  </p>
                  <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {s.hero ? (
                      <span className="kx-status kx-status--done">{t("Synthesis created")}</span>
                    ) : (
                      <button
                        type="button"
                        className="kx-btn kx-btn--primary kx-btn--sm"
                        onClick={h.heroAct}
                      >
                        <InIco name="in-plus" />
                        {t("Synthesis note")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="kx-btn kx-btn--secondary kx-btn--sm"
                      onClick={h.heroGraph}
                    >
                      <InIco name="in-graph" />
                      {t("In the graph")}
                    </button>
                    <button
                      type="button"
                      className="kx-btn kx-btn--ghost kx-btn--sm"
                      onClick={() => h.setCat("deep")}
                    >
                      {t("More depth")}
                    </button>
                  </div>
                </div>
              </article>
            )}
            {top3.length > 0 && (
              <div
                style={{
                  ...card,
                  display: "grid",
                  gridTemplateRows: "auto repeat(3,1fr)",
                  gap: 8,
                  padding: 14,
                  borderRadius: 16,
                }}
              >
                <div className="kxh-row">
                  <span className="kx-label kxh-grow">{t("For today")}</span>
                  <span className="kx-help">
                    {t("{n} of {total}", { n: top3.length, total: notLater.length })}
                  </span>
                </div>
                {top3.map((r, i) => (
                  <div key={r.k} className="kx-rec-row" style={{ boxShadow: i > 0 ? "inset 0 1px 0 0 var(--border-subtle)" : "none" }}>
                    <span className="kx-icontile" style={{ width: 40, height: 40, background: "transparent", boxShadow: "none" }}>
                      <InIco name={iconOf(r)} style={{ color: REC_ICON_COLOR[r.cat] }} />
                    </span>
                    <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                      <span className="kx-eyebrow">{t(KIND_LABEL[r.cat])}</span>
                      <strong className="kx-truncate kx-body" style={{ fontWeight: 500 }}>
                        {r.title}
                      </strong>
                      <span
                        className="kx-truncate"
                        style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-muted)" }}
                      >
                        {r.why}
                      </span>
                    </span>
                    <Cta r={r} s={s} h={h} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <Rail
            title={<span className="kx-label">{t("More impulses")}</span>}
            meta={t("{n} more", { n: rest.length })}
            step={604}
            gap={12}
            aria-label={t("More impulses")}
          >
            {rest.map((r) => {
                return (
                  <article
                    key={r.k}
                    className="kx-in"
                    style={{
                      ...card,
                      width: 290,
                      display: "grid",
                      alignContent: "start",
                      gap: 6,
                      padding: 14,
                      borderRadius: 16,
                    }}
                  >
                    <div className="kxh-row" style={{ gap: 8 }}>
                      <InIco name={iconOf(r)} sm style={{ color: "var(--text-muted)" }} />
                      <span className="kx-eyebrow kxh-grow">{t(KIND_LABEL[r.cat])}</span>
                    </div>
                    <strong className="kx-body" style={{ fontWeight: 500 }}>
                      {r.title}
                    </strong>
                    <span className="kx-clamp2 kx-meta">
                      <b style={{ fontWeight: 500, color: "var(--text-secondary)" }}>{t("Why:")}</b>{" "}
                      {r.why}
                    </span>
                    <div className="kxh-row" style={{ gap: 6 }}>
                      <Cta r={r} s={s} h={h} />
                      <button
                        type="button"
                        className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm"
                        aria-label={t("Later")}
                        title={t("Later")}
                        onClick={() => h.later(r)}
                      >
                        <InIco name="in-clock" />
                      </button>
                    </div>
                  </article>
                );
              })}
          </Rail>
        </>
      )}

      {!nothing && s.cat !== "all" && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(min(330px,100%),1fr))",
              gap: 12,
            }}
          >
            {visible.map((r) => (
              <RecCard key={r.k} r={r} s={s} h={h} />
            ))}
          </div>
          {s.cat !== "deep" && visible.length === 0 && (
            <div className="kx-emptystate kx-in">
              <Pictogram kind="stack" size="lg" className="kx-art-ruhe" />
              <strong className="kx-h-section">{t("All reviewed")}</strong>
              <span className="kx-meta">{t("New impulses arrive tomorrow morning at 06:00.")}</span>
              <button
                type="button"
                className="kx-btn kx-btn--secondary kx-btn--sm"
                onClick={h.resetLater}
              >
                {t("Show hidden ones again")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LeadThemeFull({ lead, s, h }: { lead: LeadTheme; s: RecState; h: RecHandlers }) {
  return (
    <article
      style={{
        ...card,
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) minmax(220px,36%)",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "22px 24px", display: "grid", gap: 10, alignContent: "start" }}>
        <span className="kxh-row kx-eyebrow" style={{ gap: 6, color: "var(--tag-ai-fg)" }}>
          <InIco name="in-layers" sm />
          {t("Deeper theme · Lead theme of the week")}
        </span>
        <h3 className="kx-h-page" style={{ margin: 0 }}>
          {lead.title}
        </h3>
        <p className="kx-body" style={{ margin: 0, color: "var(--text-secondary)" }}>
          {lead.long}
        </p>
        <div className="kxh-wrap" style={{ gap: 6 }}>
          {lead.tags.map(([tag, n], i) => (
            <span key={tag} className={"kx-pill kx-pill--sm" + (i === 1 ? " kx-pill--auto" : "")}>
              {tag} · {n}
            </span>
          ))}
        </div>
        <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {s.hero ? (
            <span className="kx-status kx-status--done">{t("Synthesis created in 10_Notes")}</span>
          ) : (
            <button type="button" className="kx-btn kx-btn--primary" onClick={h.heroAct}>
              <InIco name="in-plus" />
              {t("Create synthesis note")}
            </button>
          )}
          <button type="button" className="kx-btn kx-btn--secondary" onClick={h.heroGraph}>
            <InIco name="in-graph" />
            {t("Show in the graph")}
          </button>
        </div>
      </div>
      <div style={{ position: "relative", minHeight: 220 }}>
        <Img
          className="kx-photo"
          src={coverSrc(lead.img)}
          style={{ position: "absolute", inset: 0 }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, var(--bg-surface-flat) 0%, color-mix(in srgb, var(--bg-surface-flat) 55%, transparent) 30%, transparent 70%)",
          }}
        />
      </div>
    </article>
  );
}

function RecCard({ r, s, h }: { r: Recommendation; s: RecState; h: RecHandlers }) {
  const isBook = r.cover?.kind === "book";
  const isPod = r.cover?.kind === "pod";
  return (
    <article
      className="kx-in"
      style={{
        ...card,
        display: "grid",
        gridTemplateColumns: isBook ? "78px 1fr" : isPod ? "84px 1fr" : "1fr",
        gap: 14,
        padding: 14,
        borderRadius: 16,
        alignContent: "start",
      }}
    >
      {r.cover && (
        <div
          aria-hidden
          style={{
            ...(isBook
              ? { width: 78, height: 112, borderRadius: "4px 8px 8px 4px", padding: "9px 8px" }
              : { width: 84, height: 84, borderRadius: 12, padding: 9 }),
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            color: "#FFFFFF",
            background: gradient(r),
            boxShadow: "none",
          }}
        >
          <span
            style={{
              fontWeight: 500,
              fontSize: isBook ? 13 : 13,
              lineHeight: isBook ? "15px" : "14px",
              letterSpacing: 0,
            }}
          >
            {r.cover.title}
          </span>
          <span style={{ fontSize: "calc(12px * var(--kx-fs, 1))", opacity: 0.8, lineHeight: 1.5 }}>{r.cover.sub}</span>
        </div>
      )}
      <div style={{ display: "grid", gap: 6, alignContent: "start", minWidth: 0 }}>
        <span className="kxh-row kx-eyebrow" style={{ gap: 6 }}>
          <InIco name={iconOf(r)} sm style={{ color: REC_ICON_COLOR[r.cat] }} />
          {t(KIND_LABEL[r.cat])}
        </span>
        <strong className="kx-h-card">{r.title}</strong>
        {r.meta && <span className="kx-help">{r.meta}</span>}
        <span className="kx-body" style={{ color: "var(--text-secondary)" }}>
          {r.text}
        </span>
        <span className="kx-meta">
          <b style={{ fontWeight: 500, color: "var(--text-secondary)" }}>{t("Why:")}</b> {r.why}
        </span>
        <div className="kxh-row" style={{ gap: 6, marginTop: 2, flexWrap: "wrap" }}>
          <Cta r={r} s={s} h={h} />
          <button
            type="button"
            className="kx-btn kx-btn--ghost kx-btn--sm"
            onClick={() => h.later(r)}
          >
            <InIco name="in-clock" />
            {t("Later")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn--ghost kx-btn--sm"
            onClick={() => h.more(r)}
          >
            <InIco name="in-plus" />
            {t("More of this")}
          </button>
        </div>
      </div>
    </article>
  );
}
