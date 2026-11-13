"use client";

import { intlLocale, t } from "@/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical, SlidersHorizontal } from "lucide-react";
import { PROFILE } from "@/lib/workspace-data";
import { dropBefore, type HomeToggle } from "./home-utils";

const greetFor = (h: number) => (h >= 5 && h < 11 ? t("Good morning") : h >= 11 && h < 17 ? t("Good day") : t("Good evening"));
const fmtDate = (d: Date) => d.toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * Home hero (Tactile Craft v2, dummy `Home`): radial accent glow with faded noise (home.css .hm-hero), the
 * date as a micro label, the greeting as Display 32/300, "Anpassen" (which sections Home shows) and,
 * below, the briefing as a glass card (`children`).
 */
export function HomeHeader({
  now,
  sections,
  hidden,
  order,
  onToggle,
  onMove,
  children,
  top,
}: {
  /** Above the date: the live-meeting strip (Feinschliff Live `.live`). */
  top?: ReactNode;
  now: Date | null;
  sections: readonly HomeToggle[];
  hidden: ReadonlySet<string>;
  /** Bento order (keys); sections not in it (the briefing) stay fixed on top. */
  order: readonly string[];
  onToggle: (k: string) => void;
  /** Move `k` before `before` (null: to the end). */
  onMove: (k: string, before: string | null) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  /*
   * Reorder with pointer events, not HTML5 drag & drop: the Tauri WebView2 (Windows app) swallows
   * dragstart/dragover/drop for its own file drop, so draggable rows never moved there. A drag starts
   * after 5 px of movement, so a plain click still toggles the checkbox; the click after a drag is eaten.
   */
  const ptr = useRef<{ key: string; id: number; x: number; y: number; active: boolean } | null>(null);
  const eatClick = useRef(false);
  const rowAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-sort-key]") as HTMLElement | null)?.dataset.sortKey ?? null;
  const endDrag = () => {
    ptr.current = null;
    setDrag(null);
    setOver(null);
  };
  // The briefing lives in the hero (fixed at the top); every bento card follows the user's order.
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const fixed = sections.filter((s) => !order.includes(s.key));
  const sortable = order.flatMap((k) => {
    const s = byKey.get(k);
    return s ? [s] : [];
  });

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    // While "Anpassen" is open the hero sits above the floating meeting card (z 7), which otherwise covers the menu.
    <section className="hm-hero" aria-label={t("Greeting")} style={open ? { zIndex: 30 } : undefined}>
      <div className="hm-hero-in">
        {top}
        <div className="e-micro" style={{ minHeight: 15 }}>
          {now ? fmtDate(now) : " "}
        </div>
        <div className="hm-greet-row">
          <h1 className="hm-greet" data-testid="home-greeting">
            {now ? greetFor(now.getHours()) : t("Hello")}, {PROFILE.name}.
          </h1>
          <div ref={wrap} className="hm-adjust">
            <button type="button" className="e-btn e-btn--ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <SlidersHorizontal className="kx-ico" aria-hidden />
              {t("Customize")}
            </button>
            {open && (
              <div className="kx-menu kx-in hm-adjust-menu" role="menu" aria-label={t("Customize Home")}>
                <div className="kx-menu-label">{t("Show on Home")}</div>
                {fixed.map((s) => (
                  <label key={s.key} className="kx-menu-item" style={{ height: 34, cursor: "pointer" }}>
                    <span className="hm-grip hm-grip--off" aria-hidden />
                    <input type="checkbox" className="kx-check" checked={!hidden.has(s.key)} onChange={() => onToggle(s.key)} />
                    <span>{s.label}</span>
                  </label>
                ))}
                {sortable.map((s, i) => (
                  <label
                    key={s.key}
                    className="kx-menu-item hm-adjust-row"
                    data-drag={drag === s.key || undefined}
                    data-over={over === s.key || undefined}
                    data-sort-key={s.key}
                    title={t("Drag to reorder (or Alt + arrow key)")}
                    style={{ height: 34, cursor: drag ? "grabbing" : "grab", touchAction: "none", userSelect: "none" }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      ptr.current = { key: s.key, id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
                    }}
                    onPointerMove={(e) => {
                      const d = ptr.current;
                      if (!d || d.id !== e.pointerId) return;
                      if (!d.active) {
                        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
                        d.active = true;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDrag(d.key);
                      }
                      e.preventDefault();
                      const k = rowAt(e.clientX, e.clientY);
                      setOver(k && k !== d.key ? k : null);
                    }}
                    onPointerUp={(e) => {
                      const d = ptr.current;
                      if (!d || d.id !== e.pointerId) return;
                      if (d.active) {
                        // Eat only the click this pointerup produces (none when released outside the row).
                        eatClick.current = true;
                        setTimeout(() => (eatClick.current = false), 0);
                        const before = dropBefore(
                          sortable.map((x) => x.key),
                          d.key,
                          rowAt(e.clientX, e.clientY),
                        );
                        if (before !== undefined) onMove(d.key, before);
                      }
                      endDrag();
                    }}
                    onPointerCancel={endDrag}
                    onLostPointerCapture={() => {
                      if (ptr.current?.active) endDrag();
                    }}
                    onClickCapture={(e) => {
                      if (!eatClick.current) return;
                      eatClick.current = false;
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <GripVertical className="kx-ico hm-grip" aria-hidden />
                    <input
                      type="checkbox"
                      className="kx-check"
                      checked={!hidden.has(s.key)}
                      onChange={() => onToggle(s.key)}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      onKeyDown={(e) => {
                        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                        e.preventDefault();
                        if (e.key === "ArrowUp" && i > 0) onMove(s.key, sortable[i - 1]!.key);
                        if (e.key === "ArrowDown" && i < sortable.length - 1) onMove(s.key, sortable[i + 2]?.key ?? null);
                      }}
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
