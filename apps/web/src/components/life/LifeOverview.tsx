"use client";

import type { CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { ContextMenu, isContextMenuKey, menuFor, useContextMenu, type ActionId } from "@kortex/ui";
import { Ico, type IconId } from "@/components/shell/icons";
import { ThemeTile } from "@/components/theme/ThemeTile";
import { lifeTopic } from "@/lib/theme/topics";
import type { LifeAreaDetail, LifePick } from "@/lib/mock/life";
import { LIFE_AREAS } from "@/lib/mock/workspace";
import { lifeHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { NOTE_TYPES, noteById } from "@/lib/workspace-data";
import type { LifeState } from "./useLifeData";
import { feature, t } from "@/i18n";

/** The sidebar's entry of an area: short name (Health, Karriere, ...) and its line icon. */
const sidebarArea = (key: string) => LIFE_AREAS.find((l) => l.key === key);
const areaColor = (a: LifeAreaDetail) => `var(--tag-${a.tone}-dot)`;
const typeMeta = (type: string) => NOTE_TYPES[type as keyof typeof NOTE_TYPES];


/** Up to three things of an area: the server's picks (live) or the area's linked notes (mock). */
function picksFor(a: LifeAreaDetail): LifePick[] {
  if (a.picks) return a.picks.slice(0, 3);
  return a.links
    .map((id) => noteById(id))
    .filter((n) => n !== undefined)
    .slice(0, 3)
    .map((n) => ({ id: n.id, title: n.title, type: n.type }));
}

/** One area as a card: tinted glyph, name, status note and up to three things to open. */
function AreaCard({
  a,
  onOpenArea,
  onOpenItem,
  menu,
}: {
  a: LifeAreaDetail;
  onOpenArea: () => void;
  onOpenItem: (id: string) => void;
  menu: ReturnType<ReturnType<typeof useContextMenu<string>>["bind"]>;
}) {
  const side = sidebarArea(a.key);
  const icon: IconId = side?.icon ?? "life";
  const picks = picksFor(a);
  const topic = lifeTopic(a.key);
  return (
    <section
      className="lf-acard"
      style={{ "--lc": areaColor(a) } as CSSProperties}
      aria-label={a.name}
      onContextMenu={menu.onContextMenu}
    >
      <button
        type="button"
        className="lf-acard-h"
        title={t("Open {name}", { name: a.name })}
        onClick={onOpenArea}
        onKeyDown={(e) => isContextMenuKey(e) && menu.onKeyDown(e)}
      >
        <span className="lf-glyph" aria-hidden>
          {topic && <ThemeTile topic={topic} />}
          <Ico name={icon} />
        </span>
        <span className="lf-acard-name e-clamp1">{side?.label ?? a.name}</span>
      </button>
      <p className="lf-acard-note e-clamp2">{a.reflect || t("No entries in this area yet.")}</p>
      {picks.length > 0 && (
        <div className="lf-picks">
          {picks.map((p) => {
            const meta = typeMeta(p.type);
            return (
              <button key={p.id} type="button" className="lf-pick" onClick={() => onOpenItem(p.id)} title={p.title}>
                <span className="lf-glyph lf-glyph--sm" aria-hidden>
                  <Ico name={meta?.icon ?? "i-note"} />
                </span>
                <span className="lf-pick-t e-clamp1">{p.title}</span>
                <span className="e-meta e-clamp1">{meta?.label ?? p.type}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Life overview: one card per area with its status and things to open. No scores, ring or bars (2026-11-12, like
 * the mobile app): goals and habits live in Griply, an area is a page for vision, ideas and images.
 */
export function LifeOverview({ life, go, edit }: { life: LifeState; go: (key: string) => void; edit?: (key: string) => void }) {
  const { openNote, setSplit, showToast } = useShell();
  // Right-click on an area (feedback #3): open, newest note in the split, copy link, edit the vision.
  const cm = useContextMenu<string>();
  const menuArea = life.areas.find((a) => a.key === cm.menu?.target);
  const runArea = async (action: ActionId) => {
    const area = menuArea;
    if (!area) return;
    if (action === "open") go(area.key);
    else if (action === "edit") (edit ?? go)(area.key);
    else if (action === "open-split") {
      const id = area.links[0];
      if (id) {
        openNote(id);
        setSplit(true);
      }
    } else if (action === "copy-link") {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${lifeHref(area.key)}`);
        showToast(t("Link copied"));
      } catch {
        showToast(t("Link could not be copied"));
      }
    }
  };
  // Live: only the areas chosen in onboarding; the mock shows all six.
  const areas = life.areas.filter((a) => a.active !== false);
  return (
    <div className="lf-ov">
      <header className="lf-ov-head">
        <div className="lf-ov-head-t">
          <div className="lf-crumb">
            Life
            <ChevronRight className="kx-ico" aria-hidden />
            <b>{t("Overview")}</b>
          </div>
          <h1 className="lf-ov-h1">{t("Life areas")}</h1>
          <p className="lf-sub">{feature("griply") ? t("One page per area for vision, ideas and images. Goals and habits stay in Griply.") : t("One page per area for vision, ideas and images.")}</p>
        </div>
      </header>

      {life.status !== "ready" && (
        <p className="e-meta" role="status" style={{ margin: 0 }}>
          {life.status === "error" ? t("Life areas could not be loaded: {error}", { error: life.error ?? "" }) : t("Loading life areas …")}
        </p>
      )}

      <div className="lf-agrid" data-hero-list>
        {areas.map((a) => (
          <AreaCard
            key={a.key}
            a={a}
            onOpenArea={() => go(a.key)}
            onOpenItem={openNote}
            menu={cm.bind(a.key)}
          />
        ))}
      </div>
      <ContextMenu
        at={cm.menu?.at ?? null}
        label={t("Life area")}
        sections={menuFor({ kind: "life-area", hasSource: !!menuArea?.links.length })}
        onAction={(id) => void runArea(id)}
        onClose={cm.close}
      />
    </div>
  );
}
