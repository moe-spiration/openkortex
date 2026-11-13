"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelCatalogEntry } from "@kortex/db/routing";
import { Ico } from "@/components/shell/icons";
import { t } from "@/i18n";
import { AUTO_LABEL, CAPABILITY_COPY, contextLabel, modelName, priceLabel } from "./routingCopy";

const meta = (m: ModelCatalogEntry) =>
  [
    priceLabel(m),
    contextLabel(m),
    m.embedding_dimensions ? t("{n} dimensions", { n: m.embedding_dimensions }) : null,
    m.capabilities.map((c) => t(CAPABILITY_COPY[c])).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Model choice of one task: "Auto (Best Cost/Performance)" first, then the provider's catalog
 * models that can serve the task, with price per 1M tokens, context length and capabilities.
 * Search appears for longer catalogs (OpenRouter lists hundreds).
 */
export function ModelPicker({
  label,
  modelId,
  models,
  loading,
  onPick,
}: {
  label: string;
  modelId: string | null;
  models: ModelCatalogEntry[];
  loading: boolean;
  onPick: (modelId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  /** Opens upward when the space below (above the footbar) is too small for the list. */
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = modelId ? models.find((m) => m.model_id === modelId) : undefined;

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

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? models.filter((m) => `${m.model_id} ${m.display_name ?? ""}`.toLowerCase().includes(s)) : models;
    return list.slice(0, 200);
  }, [models, q]);

  const pick = (id: string | null) => {
    setOpen(false);
    setQ("");
    if (id !== modelId) onPick(id);
  };

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0, flex: "1 1 260px" }}>
      <button
        type="button"
        className="kxb kx-control kx-select"
        style={{ width: "100%", height: 36 }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("Model for {task}", { task: label })}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setUp(window.innerHeight - r.bottom < 460 && r.top > 400);
          setOpen((v) => !v);
        }}
      >
        <span className="kx-truncate" style={{ minWidth: 0 }}>
          {modelId ? (current ? modelName(current) : modelId) : AUTO_LABEL}
        </span>
        {modelId && !current && !loading && (
          <span className="kx-meta" style={{ flex: "none" }}>
            {t("not in the catalog")}
          </span>
        )}
        <Ico name="chev-d" size="sm" />
      </button>
      {open && (
        <div
          className="kx-menu kx-in"
          role="listbox"
          aria-label={t("Model for {task}", { task: label })}
          style={{ position: "absolute", left: 0, right: 0, ...(up ? { bottom: 42 } : { top: 42 }), zIndex: 30, minWidth: 280, maxHeight: 360, overflow: "auto", padding: 6 }}
        >
          {models.length > 8 && (
            <div className="kx-control" style={{ height: 34, margin: "0 0 6px" }}>
              <Ico name="search" size="sm" />
              <input autoFocus placeholder={t("Search model")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Search model")} />
            </div>
          )}
          <Option on={modelId === null} title={AUTO_LABEL} sub={t("Kortex chooses per call from the catalog, by the mode below")} onClick={() => pick(null)} />
          {loading && (
            <div className="kxh-row kx-meta" style={{ gap: 8, padding: "10px 10px" }}>
              <span className="kx-spinner" aria-hidden /> {t("Catalog loading …")}
            </div>
          )}
          {!loading && models.length === 0 && (
            <p className="kx-meta" style={{ margin: 0, padding: "10px 10px" }}>
              {t("No models in the catalog yet. “Update models” at the provider loads them; until then Auto chooses.")}
            </p>
          )}
          {shown.map((m) => (
            <Option key={m.model_id} on={m.model_id === modelId} title={modelName(m)} sub={meta(m)} onClick={() => pick(m.model_id)} />
          ))}
          {!loading && models.length > 0 && shown.length === 0 && (
            <p className="kx-meta" style={{ margin: 0, padding: "10px 10px" }}>
              {t("No model matches “{query}”.", { query: q })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Option({ on, title, sub, onClick }: { on: boolean; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      className={"kxb kx-menu-item" + (on ? " is-selected" : "")}
      style={{ width: "100%", height: "auto", minHeight: 44, padding: "6px 10px", alignItems: "center" }}
      onClick={onClick}
    >
      <span className="kxh-col kxh-grow" style={{ gap: 1, minWidth: 0 }}>
        <span className="kx-truncate" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
          {title}
        </span>
        {sub && (
          <span className="kx-meta kx-truncate" style={{ fontSize: "calc(12px * var(--kx-fs, 1))" }}>
            {sub}
          </span>
        )}
      </span>
      {on && <Ico name="check" size="sm" style={{ color: "var(--accent-ai)", flex: "none" }} />}
    </button>
  );
}
