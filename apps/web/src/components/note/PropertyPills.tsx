"use client";

import { intlLocale, msg, t } from "@/i18n";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DomainObjectType } from "@kortex/db/domain";
import { Ico } from "@/components/shell/icons";
import { fieldsOf, objectOptionLabel, type FieldDef } from "@/lib/objects/schema";
import { lastMeeting } from "@/lib/notes/backlinks";
import { useNotes } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { MOCK_TODAY, type KnowledgeItem } from "@/lib/workspace-data";
import { dayLabel } from "@/lib/format";

/*
 * Smart Object Property Header: one line of property pills under the title, driven by the
 * item's metadata and the type's field set (lib/objects/schema.ts). Click a pill to edit it.
 */

const PRIORITY: Record<string, string> = { low: msg("Low"), medium: msg("Medium"), high: msg("High"), urgent: msg("Urgent") };
const priorityLabel = (v: string) => {
  const label = PRIORITY[v];
  return label ? t(label) : v;
};

/** kx-status dot colour for status-like values. */
function statusClass(v: string): string {
  if (/fertig|erreicht|gekauft|vermietet|etabliert|täglich/i.test(v)) return "kx-status--done";
  if (/gefährdet|pausiert|ausgemustert|verkauft/i.test(v)) return "kx-status--blocked";
  if (/arbeit|kurs|prüfung|erprobt|wöchentlich/i.test(v)) return "kx-status--progress";
  return "kx-status--ai";
}

const fmtMoney = (n: number) => t("{amount} € / month", { amount: n.toLocaleString(intlLocale()) });

function display(key: string, def: FieldDef, value: unknown): ReactNode {
  if (value === undefined || value === null || value === "") return null;
  switch (def.kind) {
    case "list":
      return (value as string[]).join(" · ");
    case "money":
      return fmtMoney(Number(value));
    case "percent":
      return null; // rendered as a bar
    case "date":
      return new Date(String(value) + "T12:00:00Z").toLocaleDateString(intlLocale(), { day: "numeric", month: "short", year: "numeric" });
    case "enum":
      return key === "priority" ? priorityLabel(String(value)) : objectOptionLabel(String(value));
    case "url":
      return String(value).replace(/^https?:\/\//, "");
    case "record":
      return Object.values(value as Record<string, string>).join(" · ");
    default:
      return String(value);
  }
}

function toInput(def: FieldDef, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (def.kind === "list") return (value as string[]).join(", ");
  if (def.kind === "record") return Object.entries(value as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(", ");
  return String(value);
}

const chip: CSSProperties = { cursor: "pointer", flex: "none", maxWidth: 260 };

function FieldEditor({
  item,
  type,
  only,
  onClose,
}: {
  item: KnowledgeItem;
  type: DomainObjectType;
  only: string | null;
  onClose: () => void;
}) {
  const { setField } = useNotes();
  const fields = fieldsOf(type).filter(([k]) => !only || k === only);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(([k, d]) => [k, toInput(d, item.metadata[k])])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);

  const save = () => {
    const errs: Record<string, string> = {};
    for (const [k] of fields) {
      const err = setField(item.id, k, draft[k] ?? "");
      if (err) errs[k] = err;
    }
    setErrors(errs);
    if (!Object.keys(errs).length) onClose();
  };

  return (
    <form
      ref={ref}
      className="kx-popover kx-in"
      style={{ position: "absolute", left: 0, top: 34, zIndex: 20, display: "grid", gap: 10 }}
      aria-label={t("Edit properties")}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {fields.map(([k, d], i) => (
        <label key={k} className="kx-field">
          <span className="kx-label">{d.label}</span>
          {d.kind === "enum" ? (
            <span className="kx-control kx-control--sm">
              <select value={draft[k] ?? ""} autoFocus={i === 0} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
                <option value="">–</option>
                {d.options?.map((o) => (
                  <option key={o} value={o}>
                    {k === "priority" ? priorityLabel(o) : objectOptionLabel(o)}
                  </option>
                ))}
              </select>
            </span>
          ) : (
            <span className={"kx-control kx-control--sm" + (errors[k] ? " is-invalid" : "")}>
              <input
                type={d.kind === "date" ? "date" : "text"}
                inputMode={d.kind === "money" || d.kind === "percent" || d.kind === "number" ? "decimal" : undefined}
                placeholder={d.placeholder ?? (d.kind === "list" ? t("Comma-separated") : "")}
                value={draft[k] ?? ""}
                autoFocus={i === 0}
                aria-invalid={!!errors[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}
              />
            </span>
          )}
          {errors[k] && <span className="kx-help kx-help--error">{errors[k]}</span>}
        </label>
      ))}
      <div className="kxh-row" style={{ justifyContent: "flex-end", gap: 6 }}>
        <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={onClose}>
          {t("Cancel")}
        </button>
        <button type="submit" className="kx-btn kx-btn--primary kx-btn--sm">
          {t("Save")}
        </button>
      </div>
    </form>
  );
}

export function PropertyPills({ item, type }: { item: KnowledgeItem; type: DomainObjectType }) {
  const { items } = useNotes();
  const { openNote } = useShell();
  const [edit, setEdit] = useState<string | null | "all">(null);
  const fields = fieldsOf(type).filter(([, d]) => d.pill);
  const findByTitle = (title: string) => Object.values(items).find((i) => i.title === title);

  const pills = fields.map(([k, d]) => {
    const v = item.metadata[k];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    const open = () => setEdit(k);
    if (empty)
      return (
        <button key={k} type="button" className="kx-propchip kxb" style={{ ...chip, color: "var(--text-muted)", borderStyle: "dashed" }} onClick={open}>
          <Ico name="plus" style={{ width: 14, height: 14 }} />
          {d.label}
        </button>
      );
    if (d.kind === "percent") {
      const pct = Number(v);
      return (
        <button key={k} type="button" className="kx-propchip kxb" style={chip} onClick={open} aria-label={`${d.label}: ${pct} %`}>
          <span className="kx-progress" style={{ width: 64 }}>
            <i style={{ width: `${pct}%`, background: "var(--accent-checkin)" }} />
          </span>
          <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))" }}>
            {pct} %
          </span>
        </button>
      );
    }
    if (d.kind === "date")
      return (
        <button key={k} type="button" className="kx-datechip kxb" style={chip} onClick={open} title={d.label}>
          <Ico name="calendar" />
          {display(k, d, v)}
        </button>
      );
    if (d.kind === "link") {
      const target = findByTitle(String(v));
      return (
        <span key={k} className="kx-propchip" style={{ ...chip, gap: 4 }}>
          <button
            type="button"
            className="kx-wikilink kxb"
            style={{ color: "var(--tag-ai-fg)", padding: "0 4px" }}
            onClick={() => (target ? openNote(target.id) : open())}
            title={target ? t("Open {name}", { name: String(v) }) : t("Edit {name}", { name: d.label })}
          >
            <span className="kx-mono" style={{ opacity: 0.6 }}>
              [[
            </span>
            {String(v)}
            <span className="kx-mono" style={{ opacity: 0.6 }}>
              ]]
            </span>
          </button>
          <button type="button" className="kxb" aria-label={t("Edit {name}", { name: d.label })} onClick={open} style={{ display: "inline-flex", color: "var(--text-muted)" }}>
            <Ico name="pencil" style={{ width: 14, height: 14 }} />
          </button>
        </span>
      );
    }
    if (d.kind === "enum" && /status/.test(k))
      return (
        <button key={k} type="button" className={`kx-status kxb ${statusClass(String(v))}`} style={{ ...chip, height: 26 }} onClick={open} title={d.label}>
          {display(k, d, v)}
        </button>
      );
    return (
      <button key={k} type="button" className="kx-propchip kxb" style={chip} onClick={open} title={d.label}>
        <span style={{ color: "var(--text-muted)" }}>{d.label}</span>
        <span className="kx-truncate" style={{ color: "var(--text-primary)" }}>
          {display(k, d, v)}
        </span>
      </button>
    );
  });

  // Person: "Letztes Meeting" comes from the linked meetings, not from metadata.
  const meeting = type === "person" ? lastMeeting(item, items) : undefined;

  return (
    <div style={{ position: "relative", margin: "0 0 10px" }}>
      <div className="kx-scroll" role="group" aria-label={t("Properties")} style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 1 }}>
        {pills}
        {meeting && (
          <button type="button" className="kx-propchip kxb" style={chip} onClick={() => openNote(meeting.id)} title={t("Open last meeting")}>
            <Ico name="i-meeting" />
            <span style={{ color: "var(--text-muted)" }}>{t("Last meeting")}</span>
            <span style={{ color: "var(--text-primary)" }}>{dayLabel(meeting.date, MOCK_TODAY)}</span>
          </button>
        )}
        <button type="button" className="kx-propchip kxb" style={{ ...chip, color: "var(--text-muted)" }} onClick={() => setEdit("all")} aria-label={t("Edit all properties")} title={t("All properties")}>
          <Ico name="pencil" />
        </button>
      </div>
      {edit !== null && <FieldEditor key={edit} item={item} type={type} only={edit === "all" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
