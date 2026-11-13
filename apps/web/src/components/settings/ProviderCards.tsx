"use client";

import { AI_PROVIDERS, AI_TASKS, type AiProvider, type AiRoutingConfig } from "@kortex/db/routing";
import { Ico, type IconId } from "@/components/shell/icons";
import { t, tn } from "@/i18n";
import { PROVIDER_COPY, agoLabel } from "./routingCopy";
import type { KeyStatus } from "./keyStatus";
import type { ProviderCatalog } from "./useRouting";

const ICON: Record<AiProvider, IconId> = { anthropic: "sparkles", openrouter: "link", edenai: "mic" };

/** The three ADR-06 pillars: key present, catalog size, last refresh, refresh button. */
export function ProviderCards({
  catalog,
  keys,
  config,
  onRefresh,
}: {
  catalog: Record<AiProvider, ProviderCatalog>;
  keys: KeyStatus | null;
  config: AiRoutingConfig;
  onRefresh: (p: AiProvider) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px,100%),1fr))", gap: 12 }}>
      {AI_PROVIDERS.map((p) => {
        const c = catalog[p];
        const copy = PROVIDER_COPY[p];
        const key = keys?.[p];
        const used = AI_TASKS.filter((task) => config[task].provider === p).length;
        return (
          <section
            key={p}
            aria-label={copy.label}
            style={{
              display: "grid",
              gap: 10,
              alignContent: "start",
              padding: 16,
              borderRadius: "var(--radius-card)",
              background: "var(--bg-surface-flat)",
              boxShadow: "none",
              minWidth: 0,
            }}
          >
            <div className="kxh-row" style={{ gap: 10 }}>
              <span className="kx-icontile" aria-hidden>
                <Ico name={ICON[p]} />
              </span>
              <span className="kxh-col kxh-grow" style={{ gap: 0, minWidth: 0 }}>
                <strong className="kx-h-card">{copy.label}</strong>
                <span className="kx-meta">
                  {t(copy.kind)} · {tn(used, "{n} task", "{n} tasks")}
                </span>
              </span>
            </div>
            <p className="kx-meta" style={{ margin: 0, color: "var(--text-secondary)" }}>
              {t(copy.role)}
            </p>
            <div className="kxh-wrap" style={{ gap: 6 }}>
              {key === undefined ? (
                <span className="kx-status">{t("Checking key …")}</span>
              ) : key ? (
                <span className="kx-status kx-status--done">{t("Key set")}</span>
              ) : (
                <span className="kx-status kx-status--blocked">{t("No key")}</span>
              )}
              <span className="kx-status">
                {c.loading ? t("Loading …") : tn(c.models.length, "{n} model", "{n} models")}
              </span>
            </div>
            <span className="kx-meta">
              {c.unavailable ? t("There is no catalog in mock mode") : c.loading && !c.fetchedAt ? null : t("Catalog updated {ago}", { ago: agoLabel(c.fetchedAt) })}
            </span>
            {c.warning && (
              <span className="kx-meta" role="status" style={{ color: "var(--status-processing)" }}>
                {c.warning}
              </span>
            )}
            <button
              type="button"
              className="kx-btn kx-btn--secondary kx-btn--sm"
              style={{ justifySelf: "start" }}
              disabled={c.loading}
              onClick={() => onRefresh(p)}
            >
              {c.loading ? <span className="kx-spinner" aria-hidden /> : <Ico name="sync" />}
              {t("Update models")}
            </button>
          </section>
        );
      })}
    </div>
  );
}
