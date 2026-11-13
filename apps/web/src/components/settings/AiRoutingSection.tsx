"use client";

import { Ico } from "@/components/shell/icons";
import { rich } from "@/components/ui/rich";
import { t } from "@/i18n";
import { NoAiKeyNotice } from "./NoAiKeyNotice";
import { ProviderCards } from "./ProviderCards";
import { TaskRouting } from "./TaskRouting";
import { useAiRouting, useModelCatalog } from "./useRouting";

/**
 * "KI-Modelle & Routing" (ADR-06): the three-pillar strategy, one card per provider and the
 * per-task routing (provider + model or Auto). Saves optimistically via updateAiRouting.
 */
export function AiRoutingSection() {
  const { config, loading, error, live, lock, apply, reset } = useAiRouting();
  const { catalog, keys, refresh } = useModelCatalog();

  return (
    <>
      <div className="kx-callout" style={{ display: "grid", gap: 6, padding: "14px 16px" }}>
        <div className="kx-callout-head">
          <Ico name="sparkles" size="sm" />
          {t("Three pillars, at most three keys")}
        </div>
        <span className="kx-body" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", lineHeight: 1.4 }}>
          {rich(
            t(
              "Anthropic direct for all text tasks, OpenRouter as the gateway for vision, OCR, embeddings and alternative models, Eden AI for transcription and documents. Per task you choose provider and model or leave it to {auto}: Kortex then takes the fitting model from the current catalog. Requests to OpenRouter always go out with {flag}.",
            ),
            { auto: <strong style={{ fontWeight: 500 }}>Auto</strong>, flag: <span className="kx-mono">data_collection: &apos;deny&apos;</span> },
          )}
        </span>
      </div>

      <NoAiKeyNotice keys={keys} where="settings" />

      <ProviderCards catalog={catalog} keys={keys} config={config} onRefresh={refresh} />

      <div className="kxh-row" style={{ gap: 12, marginTop: 4 }}>
        <span className="kxh-col kxh-grow" style={{ gap: 2 }}>
          <h2 className="kx-h-section" style={{ margin: 0 }}>
            {t("Routing per task")}
          </h2>
          <span className="kx-help">
            {loading
              ? t("Loading routing …")
              : error
                ? t("Routing not loaded ({error}); the defaults are shown", { error })
                : live
                  ? t("Changes are saved right away")
                  : t("Mock mode: changes stay on this device")}
          </span>
        </span>
        <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={reset} disabled={loading}>
          <Ico name="sync" />
          {t("Defaults")}
        </button>
      </div>

      <TaskRouting config={config} catalog={catalog} keys={keys} live={live} lock={lock} onChange={(patch) => apply(patch)} />
    </>
  );
}
