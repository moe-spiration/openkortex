"use client";

import { useShell } from "@/lib/shell/store";
import { NOTE_TYPES, pillClass, type NoteSummary } from "@/lib/workspace-data";
import { Ico } from "./icons";
import { dayLabel } from "@/lib/format";

/** Note rows in the prototype's list style (kx-noterow); a click opens the half-side note drawer. */
export function NoteList({ notes, today }: { notes: NoteSummary[]; today: string }) {
  const { openNote } = useShell();
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {notes.map((n) => {
        const ty = NOTE_TYPES[n.type];
        return (
          <button
            key={n.id}
            type="button"
            className="kx-noterow kxb"
            style={{ width: "100%", height: 60, gridTemplateColumns: "auto minmax(0,1fr) auto auto", color: "var(--text-primary)" }}
            onClick={() => openNote(n.id)}
          >
            <span className="kx-icontile">
              <Ico name={ty.icon} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="kx-title kx-truncate" style={{ display: "block" }}>
                {n.title}
              </span>
              <span className="kx-snip kx-mono kx-truncate" style={{ display: "block", fontSize: "calc(12px * var(--kx-fs, 1))" }}>
                {n.path}
              </span>
            </span>
            <span className="kxh-row" style={{ gap: 4 }}>
              {n.tags.map((t) => (
                <span key={t} className={`kx-pill kx-pill--sm ${pillClass(t)}`}>
                  {t}
                </span>
              ))}
            </span>
            <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-muted)", minWidth: 96, textAlign: "right" }}>
              {dayLabel(n.date, today)}, {n.time}
            </span>
          </button>
        );
      })}
    </div>
  );
}
