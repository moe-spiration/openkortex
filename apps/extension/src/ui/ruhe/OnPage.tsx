// Ruhe UI on other pages (shadow root): selection bar, note card, highlight dock and its list. Solid surfaces, not
// glass, and the page's brightness picks light or dark (content/highlighter-ruhe.tsx sets data-theme).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BookmarkPlus, ChevronDown, Highlighter, MoreHorizontal, PanelRight, PenLine, Sparkles, StickyNote, Trash2 } from "lucide-react";
import { msg, t, tn } from "../../i18n";
import { HIGHLIGHT_COLORS, type HighlightColor } from "../../lib/requests";
import { ALT, Btn, IconBtn, Kbd, MOD, Menu, modKey, useDismiss } from "./kit";

const COLOR_LABEL: Record<HighlightColor, string> = { yellow: msg("Sand"), indigo: msg("Indigo"), green: msg("Sage"), pink: msg("Rose") };
export const colorLabel = (c: HighlightColor) => t(COLOR_LABEL[c]);

export function ColorDots({ value, onPick, small }: { value: HighlightColor; onPick: (c: HighlightColor) => void; small?: boolean }) {
  return (
    <span className="rx-seltool-dots" role="radiogroup" aria-label={t("Highlight colour")}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          data-hl={c}
          className={`rx-cdot${small ? " rx-cdot--sm" : ""}`}
          aria-checked={c === value}
          aria-pressed={c === value}
          aria-label={colorLabel(c)}
          title={colorLabel(c)}
          onClick={() => onPick(c)}
        />
      ))}
    </span>
  );
}

export interface SelectionBarProps {
  /** "new" over a text selection, "mark" over a saved highlight. */
  kind: "new" | "mark";
  color: HighlightColor;
  onColor: (c: HighlightColor) => void;
  onHighlight?: () => void;
  onNote: () => void;
  onAsk: () => void;
  onSavePrompt?: () => void;
  onRemove?: () => void;
  style?: CSSProperties;
}

/** Colour, Highlight H, Note N, Ask A, ⋯ (save as prompt, remove). Keeps the page selection while used. */
export function SelectionBar({ kind, color, onColor, onHighlight, onNote, onAsk, onSavePrompt, onRemove, style }: SelectionBarProps) {
  const [more, setMore] = useState(false);
  const items = [
    ...(onSavePrompt ? [{ key: "prompt", icon: <BookmarkPlus />, label: t("Save as prompt") }] : []),
    ...(onRemove ? [{ key: "remove", icon: <Trash2 />, label: t("Remove highlight"), sep: !!onSavePrompt }] : []),
  ];
  return (
    <div className="rx-seltool" role="toolbar" aria-label={kind === "new" ? t("Selection") : t("Highlight")} style={style} onMouseDown={(e) => e.preventDefault()}>
      <ColorDots value={color} onPick={onColor} />
      <span className="rx-seltool-vr" aria-hidden />
      {kind === "new" && onHighlight && (
        <button type="button" className="rx-tb" onClick={onHighlight} title={`${t("Highlight in Kortex")} (H)`} aria-keyshortcuts="H">
          <Highlighter aria-hidden />
          {t("Highlight")}
        </button>
      )}
      <button type="button" className="rx-tb" onClick={onNote} title={`${t("Note")} (N)`} aria-keyshortcuts="N">
        <StickyNote aria-hidden />
        {t("Note")}
      </button>
      <button type="button" className="rx-tb" onClick={onAsk} title={`${t("Ask Kortex about it")} (A)`} aria-keyshortcuts="A">
        <Sparkles aria-hidden />
        {t("Ask")}
      </button>
      {items.length > 0 && (
        <>
          <span className="rx-seltool-vr" aria-hidden />
          <IconBtn label={t("More")} pressed={more} onClick={() => setMore(!more)}>
            <MoreHorizontal />
          </IconBtn>
        </>
      )}
      {more && (
        <Menu
          label={t("More")}
          style={{ right: 0, top: 40, width: 210 }}
          items={items}
          onClose={() => setMore(false)}
          onPick={(k) => {
            setMore(false);
            if (k === "prompt") onSavePrompt?.();
            else onRemove?.();
          }}
        />
      )}
    </div>
  );
}

/** Note card for a new or a saved highlight: quote, note, colour, delete, Save ⌘↵. */
export function NoteCard({
  quote,
  color,
  note: initialNote,
  saved,
  onSave,
  onCancel,
  onDelete,
  style,
}: {
  quote: string;
  color: HighlightColor;
  note?: string;
  saved?: boolean;
  onSave: (note: string, color: HighlightColor) => void;
  onCancel: () => void;
  onDelete?: () => void;
  style?: CSSProperties;
}) {
  const [note, setNote] = useState(initialNote ?? "");
  const [c, setC] = useState<HighlightColor>(color);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, onCancel, ref);
  return (
    <div ref={ref} className="rx-pop" style={style} role="dialog" aria-label={t("Note on the highlight")}>
      <div style={{ display: "flex", gap: 10, padding: "12px 14px 4px" }}>
        <span className="rx-hl-bar" data-hl={c} aria-hidden />
        <div className="rx-muted rx-clamp2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {quote}
        </div>
      </div>
      <div style={{ padding: "8px 14px" }}>
        <label className="rx-field rx-field--area">
          <textarea
            autoFocus
            rows={3}
            style={{ minHeight: 60 }}
            value={note}
            maxLength={4000}
            placeholder={t("Why does this matter?")}
            aria-label={t("Note")}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && modKey(e)) {
                e.preventDefault();
                onSave(note, c);
              }
            }}
          />
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px 10px 14px" }}>
        <ColorDots small value={c} onPick={setC} />
        <span className="rx-grow" />
        {onDelete && (
          <IconBtn small label={saved ? t("Remove highlight") : t("Discard")} onClick={onDelete}>
            <Trash2 />
          </IconBtn>
        )}
        <Btn variant="pri" kbd={`${MOD}↵`} onClick={() => onSave(note, c)}>
          {t("Save")}
        </Btn>
      </div>
    </div>
  );
}

export interface DockItem {
  id: string;
  quote: string;
  note?: string;
  color?: string;
  saved: boolean;
}

/** Bottom right: the page's highlight count; opens the list (jump with ↑↓ / click). */
export function HighlightDock({ items, onJump, onOpenPanel }: { items: DockItem[]; onJump: (id: string) => void; onOpenPanel?: () => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  useEffect(() => setActive(0), [open]);
  if (!items.length) return null;
  const allSaved = items.every((i) => i.saved);
  return (
    <div ref={ref}>
      {open && (
        <div
          className="rx-pop"
          style={{ right: 16, bottom: 58, width: 310 }}
          role="dialog"
          aria-label={t("Highlights on this page")}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = (active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
              setActive(next);
              onJump(items[next]!.id);
            }
          }}
        >
          <div className="rx-lab" style={{ padding: "6px 8px 0 14px", minHeight: 40, color: "var(--t1)", fontWeight: 600, fontSize: 13 }}>
            {t("Highlights")} <span className="rx-c rx-num">{items.length}</span>
            <span className="rx-grow" />
            {onOpenPanel && (
              <IconBtn small label={t("Side panel")} kbd={`${ALT}S`} onClick={onOpenPanel}>
                <PanelRight />
              </IconBtn>
            )}
          </div>
          <div style={{ padding: "0 6px 6px", maxHeight: 320, overflow: "auto" }}>
            {items.map((h, i) => (
              <button key={h.id} type="button" className="rx-hl" data-hl={h.color ?? "yellow"} style={i === active ? { background: "var(--lum-3)" } : undefined} onClick={() => (setActive(i), onJump(h.id))}>
                <span className="rx-hl-bar" aria-hidden />
                <span style={{ minWidth: 0 }}>
                  <span className="rx-hl-q rx-clamp2">{h.quote}</span>
                  {h.note && (
                    <span className="rx-hl-n">
                      <PenLine aria-hidden />
                      <span className="rx-trunc">{h.note}</span>
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <div className="rx-hints" style={{ padding: "8px 14px", borderTop: "1px solid var(--hair)" }}>
            <span>
              <Kbd>↑↓</Kbd>
              {t("jump")}
            </span>
            {onOpenPanel && (
              <span>
                <Kbd>{`${ALT}S`}</Kbd>
                {t("Side panel")}
              </span>
            )}
            <span className="rx-grow" />
            <span>
              <span className={`rx-dot ${allSaved ? "rx-dot--ok" : "rx-dot--warn"}`} aria-hidden /> {allSaved ? t("in Kortex") : t("being saved")}
            </span>
          </div>
        </div>
      )}
      <button type="button" className="rx-fab" aria-expanded={open} aria-label={tn(items.length, "{n} highlight on this page", "{n} highlights on this page")} onClick={() => setOpen(!open)}>
        <Highlighter className="rx-fab-ico" aria-hidden />
        <span className="rx-num">{items.length}</span>
        <ChevronDown aria-hidden style={{ color: "var(--t4)", width: 12, height: 12 }} />
      </button>
    </div>
  );
}
