"use client";

import { t, tx } from "@/i18n";
import { ACCENTS } from "@/lib/shell/accent";

/** Accent swatches + custom colour (shared with the onboarding). */
export function AccentSwatches({ value, onChange, custom, hex, showCustom = true }: { value: string; onChange: (a: string) => void; custom: boolean; hex: string; showCustom?: boolean }) {
  return (
    <div className="kxh-row" style={{ gap: 12, flexWrap: "wrap" }} role="radiogroup" aria-label={t("Accent color")}>
      {ACCENTS.map((a) => {
        const on = value === a.id;
        return (
          <button
            key={a.id}
            type="button"
            className="kxb"
            role="radio"
            aria-checked={on}
            aria-label={t(a.label)}
            title={t(a.label)}
            onClick={() => onChange(a.id)}
            style={{ display: "grid", justifyItems: "center", gap: 6 }}
          >
            <span
              style={{
                display: "block",
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: a.hex,
                boxShadow: on ? `0 0 0 3px var(--bg-surface-flat), 0 0 0 5px ${a.hex}` : "inset 0 0 0 1px rgba(255,255,255,0.12)",
              }}
            />
            <span style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}>{t(a.label)}</span>
          </button>
        );
      })}
      {showCustom && (
        <label style={{ display: "grid", justifyItems: "center", gap: 6, cursor: "pointer" }}>
          <span
            style={{
              position: "relative",
              display: "block",
              width: 36,
              height: 36,
              borderRadius: "50%",
              overflow: "hidden",
              background: "conic-gradient(#F43F5E, #F59E0B, #14B8A6, #3B82F6, #8B5CF6, #F43F5E)",
              boxShadow: custom ? `0 0 0 3px var(--bg-surface-flat), 0 0 0 5px ${value}` : "none",
            }}
          >
            <input
              type="color"
              aria-label={t("Custom accent color")}
              value={hex}
              onChange={(e) => onChange(e.target.value)}
              style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer", border: 0, padding: 0 }}
            />
          </span>
          <span style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}>{tx("color", "Custom")}</span>
        </label>
      )}
    </div>
  );
}
