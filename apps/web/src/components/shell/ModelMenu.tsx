"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AUTO_MODES } from "@kortex/db/routing";
import { AUTO_MODE_COPY, PROVIDER_COPY, modelName, priceLabel } from "@/components/settings/routingCopy";
import { CHAT_PROVIDERS, useChatModel } from "@/lib/shell/chat-model";
import { useShell } from "@/lib/shell/store";
import { t } from "@/i18n";
import { Ico } from "./icons";
import { OrbitPopover, useOutside, type PopGroup } from "./TargetMenu";

/*
 * Orbit-Bar Modell-Chip ("Auto" by default, Tactile Craft decision 9): shows and sets the user's
 * chat_reasoning route (ADR-06). Models come from the catalog (GET /api/models?task=chat_reasoning),
 * never from a hard-coded list; mock mode shows the default route read-only.
 */

const MAX_ROWS = 60;

export function ModelMenu() {
  const { modelOpen, setModelOpen, showToast } = useShell();
  const m = useChatModel(showToast);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { route, catalog, loadCatalog, reload } = m;
  const models = catalog[route.provider];
  const current = route.model_id ? models?.find((x) => x.model_id === route.model_id) : undefined;
  const label = route.model_id
    ? current
      ? modelName(current)
      : (route.model_id.split("/").pop() ?? route.model_id)
    : "Auto";
  const detail = route.model_id ? label : `Auto · ${t(AUTO_MODE_COPY[route.auto_mode ?? "balanced"])}`;

  // Opening the menu refreshes the route (the settings page may have changed it) and the catalog.
  useEffect(() => {
    if (!modelOpen) return;
    setQ("");
    void reload();
  }, [modelOpen, reload]);
  useEffect(() => {
    if (modelOpen) void loadCatalog(route.provider);
  }, [modelOpen, route.provider, loadCatalog]);
  // Label of an exact model needs its catalog entry once.
  useEffect(() => {
    if (route.model_id && !models) void loadCatalog(route.provider);
  }, [route.model_id, route.provider, models, loadCatalog]);
  useOutside(ref, modelOpen, () => setModelOpen(false));

  const groups = useMemo<PopGroup[]>(() => {
    const needle = q.trim().toLowerCase();
    const autos = AUTO_MODES.map((mode) => ({
      id: "auto:" + mode,
      label: `Auto · ${t(AUTO_MODE_COPY[mode])}`,
      help: mode === "balanced" ? t("Best cost/performance") : undefined,
      icon: "orbit-sparkles" as const,
      on: !route.model_id && (route.auto_mode ?? "balanced") === mode,
      disabled: m.live ? undefined : t("In mock mode the model is not saved"),
    })).filter((a) => !needle || a.label.toLowerCase().includes(needle));
    const all = models ?? [];
    const hits = (needle ? all.filter((x) => (x.model_id + " " + (x.display_name ?? "")).toLowerCase().includes(needle)) : all).slice(0, MAX_ROWS);
    const out: PopGroup[] = [];
    if (autos.length) out.push({ label: t("Routing"), items: autos });
    if (hits.length)
      out.push({
        label: PROVIDER_COPY[route.provider].label + (route.provider === "openrouter" ? ` · ${t("without data retention")}` : ""),
        items: hits.map((x) => ({
          id: "model:" + x.model_id,
          label: modelName(x),
          help: priceLabel(x) ?? undefined,
          icon: "orbit-settings" as const,
          on: route.model_id === x.model_id,
        })),
      });
    return out;
  }, [q, models, route.model_id, route.auto_mode, route.provider, m.live]);

  const pick = (id: string) => {
    if (id.startsWith("auto:")) void m.pickAuto(id.slice(5) as (typeof AUTO_MODES)[number]);
    else {
      const x = models?.find((y) => y.model_id === id.slice(6));
      if (x) void m.pickModel(x);
    }
    setModelOpen(false);
  };

  return (
    <div ref={ref} className="kx-orbit-optwrap">
      <button
        type="button"
        className="kx-orbit-chip kx-orbit-chip--model"
        aria-haspopup="menu"
        aria-expanded={modelOpen}
        aria-label={t("Chat model: {model}", { model: detail })}
        title={t("Chat model: {model}", { model: `${PROVIDER_COPY[route.provider].label} · ${detail}` })}
        onClick={() => setModelOpen(!modelOpen)}
      >
        <i className="kx-orbit-dot" aria-hidden />
        <span className="kx-orbit-chip-l kx-truncate">{label}</span>
        <Ico name="chev-d" size={14} />
      </button>
      {modelOpen && (
        <OrbitPopover
          label={t("Chat model")}
          search={t("Search model …")}
          query={q}
          onQuery={setQ}
          groups={groups}
          onPick={pick}
          onClose={() => setModelOpen(false)}
          empty={m.live ? (m.catalogState.loading ? t("Loading catalog …") : t("No model found")) : t("No match")}
          head={
            <div className="kx-tabs kx-tabs--sm kx-orbit-pop-tabs" role="tablist" aria-label={t("Provider")}>
              {CHAT_PROVIDERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="kx-tab"
                  role="tab"
                  aria-selected={route.provider === p}
                  disabled={!m.live}
                  onClick={() => route.provider !== p && void m.pickProvider(p)}
                >
                  {PROVIDER_COPY[p].label}
                </button>
              ))}
            </div>
          }
          foot={
            <>
              {!m.live && <div className="kx-orbit-pop-note">{t("There is no model catalog in mock mode.")}</div>}
              {m.live && m.catalogState.loading && !models && (
                <div className="kx-orbit-pop-note">
                  <span className="kx-spinner" aria-hidden /> {t("Loading catalog")}
                </div>
              )}
              {m.catalogState.warning && <div className="kx-orbit-pop-note">{m.catalogState.warning}</div>}
              <Link href="/settings?section=ai" className="kx-orbit-mi kx-orbit-pop-link" onClick={() => setModelOpen(false)}>
                <span className="kx-orbit-glyph" aria-hidden>
                  <Ico name="orbit-settings" size={11} />
                </span>
                {t("Routing of all tasks")}
              </Link>
            </>
          }
        />
      )}
    </div>
  );
}
