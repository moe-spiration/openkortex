"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/*
 * Small building blocks of the Ruhe view bars (2026-11-27): a button that opens a quiet panel below it ("Filter",
 * "Anzeige", "Typen", "…") and a segmented choice for such panels. Closes on Escape and on a click outside.
 * Styles: packages/ui/src/styles/ruhe-pop.css.
 */

export function RuhePop({
  label,
  icon,
  count,
  iconOnly,
  align = "end",
  wide,
  children,
}: {
  label: string;
  icon?: ReactNode;
  /** Number of active settings inside, shown as a quiet badge. */
  count?: number;
  /** Shows only the icon (the label becomes the accessible name), e.g. the "…" menu. */
  iconOnly?: boolean;
  align?: "start" | "end";
  wide?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="rz-pop" ref={ref}>
      <button
        type="button"
        className={iconOnly ? "rz-bib" : "rz-bbtn rz-bbtn--ghost"}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {!iconOnly && label}
        {!!count && <span className="rz-pop-n">{count}</span>}
      </button>
      {open && (
        <div id={id} className={"rz-pop-panel" + (wide ? " is-wide" : "")} data-align={align} role="dialog" aria-label={label}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** One labelled row of choices inside a RuhePop panel. */
export function RuheSeg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="rz-pop-row">
      <span className="rz-pop-l">{label}</span>
      <div className="rz-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A plain menu entry inside a RuhePop panel. */
export function RuheMenuItem({ icon, children, onClick, href, external }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; href?: string; external?: boolean }) {
  if (href)
    return (
      <a className="rz-pop-item" href={href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})} onClick={onClick}>
        {icon}
        {children}
      </a>
    );
  return (
    <button type="button" className="rz-pop-item" onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
