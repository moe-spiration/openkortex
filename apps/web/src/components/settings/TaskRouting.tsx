"use client";

import {
  AI_TASKS,
  AUTO_MODES,
  TASK_PROVIDERS,
  modelServesTask,
  type AiProvider,
  type AiRoutingConfig,
  type AiRoutingPatch,
  type AiTask,
  type EmbeddingLock,
} from "@kortex/db/routing";
import { REEMBED_COMMAND } from "@/lib/settings/embedding-lock";
import { rich } from "@/components/ui/rich";
import { t } from "@/i18n";
import { AUTO_MODE_COPY, EMBEDDINGS_HINT, PROVIDER_COPY, TASK_COPY } from "./routingCopy";
import type { KeyStatus } from "./keyStatus";
import { ModelPicker } from "./ModelPicker";
import type { ProviderCatalog } from "./useRouting";

/**
 * One row per AI task: provider (only those TASK_PROVIDERS allows), model or Auto, Auto mode.
 * With an embedding lock the embeddings row is read-only (locked provider + model, re-embed hint).
 */
export function TaskRouting({
  config,
  catalog,
  keys,
  live,
  lock,
  onChange,
}: {
  config: AiRoutingConfig;
  catalog: Record<AiProvider, ProviderCatalog>;
  keys: KeyStatus | null;
  live: boolean;
  lock: EmbeddingLock | null;
  onChange: (patch: AiRoutingPatch) => void;
}) {
  return (
    <div style={{ borderRadius: "var(--radius-card)", background: "var(--bg-surface-flat)", boxShadow: "none", padding: "0 18px" }}>
      {AI_TASKS.map((task, i) =>
        task === "embeddings" && lock ? (
          <LockedEmbeddingsRow key={task} lock={lock} last={i === AI_TASKS.length - 1} />
        ) : (
          <TaskRow
            key={task}
            task={task}
            last={i === AI_TASKS.length - 1}
            config={config}
            catalog={catalog}
            keys={keys}
            live={live}
            onChange={onChange}
          />
        ),
      )}
    </div>
  );
}

/** Embeddings once vectors exist: fixed model; changing it means re-embedding every chunk. */
function LockedEmbeddingsRow({ lock, last }: { lock: EmbeddingLock; last: boolean }) {
  const copy = TASK_COPY.embeddings;
  return (
    <div style={{ display: "grid", gap: 10, padding: "14px 0", boxShadow: last ? "none" : "inset 0 -1px 0 0 var(--border-subtle)" }}>
      <div className="kxh-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <span className="kxh-col kxh-grow" style={{ gap: 1, minWidth: 180 }}>
          <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{t(copy.label)}</span>
          <span className="kx-help">{t(copy.help)}</span>
        </span>
        <span className="kx-badge">{t("Fixed")}</span>
      </div>
      <div className="kxh-row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="kx-control kx-control--muted kxh-grow" style={{ minWidth: 220 }} aria-label={t("Embedding model for {task}", { task: t(copy.label) })}>
          <span className="kx-truncate">
            {PROVIDER_COPY[lock.provider].label} · <span className="kx-mono">{lock.model_id}</span> ·{" "}
            <span className="kx-mono">{lock.dimensions}</span>
          </span>
        </span>
      </div>
      <span className="kx-help">
        <strong style={{ fontWeight: 500 }}>{t("Re-index:")}</strong>{" "}
        {rich(t("Your vectors were created with this model. Another embedding model needs a re-embedding of all chunks: {command} (without {flag} only a dry run)."), {
          command: <span className="kx-mono">{REEMBED_COMMAND()}</span>,
          flag: <span className="kx-mono">--yes</span>,
        })}
      </span>
    </div>
  );
}

function TaskRow({
  task,
  last,
  config,
  catalog,
  keys,
  live,
  onChange,
}: {
  task: AiTask;
  last: boolean;
  config: AiRoutingConfig;
  catalog: Record<AiProvider, ProviderCatalog>;
  keys: KeyStatus | null;
  live: boolean;
  onChange: (patch: AiRoutingPatch) => void;
}) {
  const route = config[task];
  const copy = TASK_COPY[task];
  const cat = catalog[route.provider];
  const models = cat.models.filter((m) => m.provider === route.provider && modelServesTask(m, task));
  const auto = route.model_id === null;
  // Keys only matter when the data is live (mock mode never calls a provider).
  const noKey = live && keys !== null && !keys[route.provider];
  return (
    <div style={{ display: "grid", gap: 10, padding: "14px 0", boxShadow: last ? "none" : "inset 0 -1px 0 0 var(--border-subtle)" }}>
      <div className="kxh-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <span className="kxh-col kxh-grow" style={{ gap: 1, minWidth: 180 }}>
          <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{t(copy.label)}</span>
          <span className="kx-help">{t(copy.help)}</span>
        </span>
        <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={t("Provider for {task}", { task: t(copy.label) })}>
          {TASK_PROVIDERS[task].map((p) => (
            <button
              key={p}
              type="button"
              className="kx-tab"
              role="tab"
              aria-selected={route.provider === p}
              onClick={() => route.provider !== p && onChange({ [task]: { provider: p } })}
            >
              {PROVIDER_COPY[p].label}
            </button>
          ))}
        </div>
      </div>
      <div className="kxh-row" style={{ gap: 10, flexWrap: "wrap" }}>
        <ModelPicker
          label={t(copy.label)}
          modelId={route.model_id}
          models={models}
          loading={cat.loading}
          onPick={(model_id) => onChange({ [task]: model_id === null ? { model_id: null, auto_mode: route.auto_mode ?? "balanced" } : { model_id } })}
        />
        {auto && (
          <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={t("Auto mode for {task}", { task: t(copy.label) })} style={{ flex: "none" }}>
            {AUTO_MODES.map((m) => {
              const on = (route.auto_mode ?? "balanced") === m;
              return (
                <button
                  key={m}
                  type="button"
                  className="kx-tab"
                  role="tab"
                  aria-selected={on}
                  onClick={() => !on && onChange({ [task]: { auto_mode: m } })}
                >
                  {t(AUTO_MODE_COPY[m])}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {task === "embeddings" && (
        <span className="kx-help">
          <span className="kx-mono">1536</span> · {t(EMBEDDINGS_HINT)}
        </span>
      )}
      {noKey && (
        <span className="kx-help" role="status" style={{ color: "var(--status-processing)" }}>
          {t("No key is set for {provider}; this task only runs once it is stored on the server.", { provider: PROVIDER_COPY[route.provider].label })}
        </span>
      )}
    </div>
  );
}
