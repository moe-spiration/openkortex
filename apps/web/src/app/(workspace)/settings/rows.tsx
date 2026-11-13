"use client";

import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Ico, type IconId } from "@/components/shell/icons";
import { t, tx } from "@/i18n";

/*
 * Settings rows exactly as WebApp.dc.html draws them: a rounded card (padding 0 18px) of rows with
 * a hairline between them. Toggle rows (60px, kx-switch), value rows (60px, value + chevron) and
 * shortcut rows (52px, kx-kbd keys).
 */

export const card: CSSProperties = {
  padding: 18,
  borderRadius: "var(--radius-card)",
  background: "var(--bg-surface-flat)",
  boxShadow: "none",
};

const line = (last: boolean) => (last ? "none" : "inset 0 -1px 0 0 var(--border-subtle)");

export function RowsCard({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <div style={{ borderRadius: "var(--radius-card)", background: "var(--bg-surface-flat)", boxShadow: "none", padding: "0 18px" }}>
      {rows.map((r, i) => (
        <div key={i} style={{ boxShadow: line(i === rows.length - 1) }}>
          {r}
        </div>
      ))}
    </div>
  );
}

function Text({ label, help, icon }: { label: string; help?: ReactNode; icon?: IconId }) {
  return (
    <>
      {icon && (
        <span className="kx-icontile" aria-hidden>
          <Ico name={icon} />
        </span>
      )}
      <span className="kxh-col kxh-grow" style={{ gap: 1 }}>
        <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{label}</span>
        {help && <span className="kx-help">{help}</span>}
      </span>
    </>
  );
}

export function ToggleRow({ label, help, icon, on, onChange }: { label: string; help?: ReactNode; icon?: IconId; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="kxh-row" style={{ gap: 14, minHeight: 60, cursor: "pointer" }}>
      <Text label={label} help={help} icon={icon} />
      <input type="checkbox" className="kx-switch" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
    </label>
  );
}

export interface Option {
  value: string;
  label: string;
}

/**
 * Value row: label + help left, value + chevron right. With `options` a click opens a menu to pick
 * the value (the prototype cycles on click; a menu shows the choices); otherwise `onClick` runs.
 */
export function ValueRow({
  label,
  help,
  value,
  icon,
  onClick,
  options,
  selected,
  onSelect,
  trailing,
}: {
  label: string;
  help?: ReactNode;
  value?: ReactNode;
  icon?: IconId;
  onClick?: () => void;
  options?: Option[];
  selected?: string;
  onSelect?: (v: string) => void;
  /** Replaces the chevron (e.g. a status chip for non-interactive rows). */
  trailing?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const interactive = !!(options || onClick);
  const body = (
    <>
      <Text label={label} help={help} icon={icon} />
      {value !== undefined && <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}>{value}</span>}
      {trailing ?? (interactive && <Ico name="chev-r" size="sm" style={{ color: "var(--text-muted)" }} />)}
    </>
  );
  if (!interactive) {
    return (
      <div className="kxh-row" style={{ width: "100%", gap: 14, minHeight: 60 }}>
        {body}
      </div>
    );
  }
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="kxb kxh-row"
        style={{ width: "100%", gap: 14, minHeight: 60 }}
        aria-haspopup={options ? "menu" : undefined}
        aria-expanded={options ? open : undefined}
        onClick={() => (options ? setOpen((v) => !v) : onClick?.())}
      >
        {body}
      </button>
      {options && open && (
        <div className="kx-menu kx-in" role="menu" aria-label={label} style={{ position: "absolute", right: 0, top: 52, zIndex: 20, minWidth: 240 }}>
          {options.map((o) => {
            const on = o.value === selected;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className={"kxb kx-menu-item" + (on ? " is-selected" : "")}
                style={{ width: "100%" }}
                onClick={() => {
                  setOpen(false);
                  onSelect?.(o.value);
                }}
              >
                <span>{o.label}</span>
                {on && <Ico name="check" size="sm" style={{ marginLeft: "auto", color: "var(--accent-ai)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function KeysRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="kxh-row" style={{ gap: 14, minHeight: 52 }}>
      <span className="kxh-grow" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
        {label}
      </span>
      <span className="kx-keys">
        {keys.map((k) => (
          <span key={k} className="kx-kbd">
            {k}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Editable value row (60px): shows the value like ValueRow; a click turns it into an inline input.
 * Enter or "Sichern" saves (`onSave` may reject with a message), Esc cancels.
 */
export function TextEditRow({
  label,
  help,
  value,
  display,
  placeholder,
  onSave,
  openRef,
}: {
  label: string;
  help?: ReactNode;
  value: string;
  /** Lets another control (e.g. "Bild ändern") open the editor. */
  openRef?: { current: (() => void) | null };
  /** Shown instead of the raw value while not editing (e.g. a masked address). */
  display?: ReactNode;
  placeholder?: string;
  onSave: (v: string) => Promise<string | null> | string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = () => {
    setDraft(value);
    setError(null);
    setEditing(true);
  };
  if (openRef) openRef.current = start;
  const save = async () => {
    if (busy) return;
    if (draft.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const err = await onSave(draft.trim());
    setBusy(false);
    if (err) setError(err);
    else setEditing(false);
  };
  if (!editing)
    return <ValueRow label={label} help={help} value={display ?? (value || placeholder || "–")} onClick={start} />;
  return (
    <div className="kxh-row" style={{ gap: 14, minHeight: 60, padding: "8px 0" }}>
      <span className="kxh-col" style={{ gap: 1, flex: "none", width: 180 }}>
        <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{label}</span>
        {error ? <span className="kx-help" style={{ color: "var(--status-urgent-text)" }}>{error}</span> : help && <span className="kx-help">{help}</span>}
      </span>
      <input
        className="kx-input kxh-grow"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        autoFocus
        style={{ minWidth: 0, height: 34, padding: "0 10px", borderRadius: "var(--radius-control)", boxShadow: "inset 0 0 0 1px var(--border-subtle)", background: "var(--bg-surface-muted)" }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          else if (e.key === "Escape") {
            e.stopPropagation();
            setEditing(false);
          }
        }}
      />
      <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => setEditing(false)}>
        {t("Cancel")}
      </button>
      <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" disabled={busy} onClick={() => void save()}>
        {tx("settings", "Save")}
      </button>
    </div>
  );
}
