"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AI_PROVIDERS,
  DEFAULT_AI_ROUTING,
  mergeAiRouting,
  parseAiRouting,
  parseEmbeddingLock,
  type AiProvider,
  type AiRoutingConfig,
  type AiRoutingPatch,
  type EmbeddingLock,
  type ModelCatalogEntry,
} from "@kortex/db/routing";
import type { Json } from "@kortex/db/types";
import { useSettings } from "@/lib/settings/store";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import { embeddingsPatchError, withoutEmbeddings } from "@/lib/settings/embedding-lock";
import { getAiRouting, getEmbeddingLockStatus, updateAiRouting } from "@/server/routing/actions";
import { getAiKeyStatus, type KeyStatus } from "./keyStatus";
import { t } from "@/i18n";

/**
 * The user's ADR-06 task routing.
 * Live: `getAiRouting` / `updateAiRouting` server actions, optimistic with rollback.
 * Mock: the user_settings mock (lib/settings/store.tsx, localStorage), same validation via mergeAiRouting.
 * `lock`: the user's embedding_lock. While set, the embeddings route is read-only (re-embed via md-sync).
 */
export function useAiRouting() {
  const live = isLiveData();
  const { user, updateUserSettings } = useSettings();
  const { showToast } = useShell();
  const [config, setConfig] = useState<AiRoutingConfig>(() => parseAiRouting(live ? DEFAULT_AI_ROUTING : user.ai_routing_config));
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const [liveLock, setLiveLock] = useState<EmbeddingLock | null>(null);
  const lock = live ? liveLock : parseEmbeddingLock(user.embedding_lock);
  const latest = useRef(config);
  latest.current = config;

  useEffect(() => {
    if (!live) {
      setConfig(parseAiRouting(user.ai_routing_config));
      return;
    }
    let alive = true;
    void getEmbeddingLockStatus()
      .then((res) => {
        if (alive && res.ok) setLiveLock(res.data);
      })
      .catch(() => {});
    void getAiRouting().then((res) => {
      if (!alive) return;
      setLoading(false);
      if (res.ok) setConfig(res.data);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
    // The mock path follows the settings store; live loads once.
  }, [live, user.ai_routing_config]);

  const apply = useCallback(
    (patch: AiRoutingPatch, done?: string) => {
      const locked = embeddingsPatchError(patch, lock);
      if (locked) {
        showToast(locked);
        return;
      }
      const before = latest.current;
      let next: AiRoutingConfig;
      try {
        next = mergeAiRouting(before, patch);
      } catch {
        showToast(t("This combination is not allowed"));
        return;
      }
      setConfig(next);
      if (!live) {
        updateUserSettings({ ai_routing_config: next as unknown as Json });
        if (done) showToast(done);
        return;
      }
      void updateAiRouting(patch).then((res) => {
        if (res.ok) {
          setConfig(res.data);
          if (done) showToast(done);
        } else {
          setConfig(before);
          showToast(t("Not saved: {error}", { error: res.error }));
        }
      });
    },
    [live, lock, showToast, updateUserSettings],
  );

  // A locked embeddings route keeps its model; every other task goes back to the defaults.
  const reset = useCallback(() => {
    const all: AiRoutingPatch = { ...DEFAULT_AI_ROUTING };
    apply(lock ? withoutEmbeddings(all) : all, t("Routing reset to the defaults"));
  }, [apply, lock]);

  return { config, loading, error, live, lock, apply, reset };
}

export interface ProviderCatalog {
  provider: AiProvider;
  models: ModelCatalogEntry[];
  fetchedAt: string | null;
  source: "live" | "cache" | null;
  warning: string | null;
  loading: boolean;
  /** Mock mode without a reachable catalog API (expected: it needs a signed-in user). */
  unavailable: boolean;
}

interface ModelsResponse {
  ok: true;
  providers: { provider: AiProvider; source: "live" | "cache"; fetched_at: string | null; warning?: string; models: ModelCatalogEntry[] }[];
}

const emptyCatalog = (loading: boolean): Record<AiProvider, ProviderCatalog> => {
  const one = (provider: AiProvider): ProviderCatalog => ({ provider, models: [], fetchedAt: null, source: null, warning: null, loading, unavailable: false });
  return { anthropic: one("anthropic"), openrouter: one("openrouter"), edenai: one("edenai") };
};

/**
 * Model catalog per provider from `GET /api/models` (cached kortex.ai_model_catalog; the server
 * runs discovery when it is stale or on `refresh=1`). In mock mode the API usually refuses (no
 * signed-in user); the cards then show the mock empty state instead of an error.
 */
export function useModelCatalog() {
  const live = isLiveData();
  const { showToast } = useShell();
  const [catalog, setCatalog] = useState<Record<AiProvider, ProviderCatalog>>(() => emptyCatalog(true));
  const [keys, setKeys] = useState<KeyStatus | null>(null);

  const load = useCallback(
    async (provider?: AiProvider, refresh = false) => {
      const targets = provider ? [provider] : [...AI_PROVIDERS];
      setCatalog((c) => ({ ...c, ...Object.fromEntries(targets.map((p) => [p, { ...c[p], loading: true }])) }));
      const qs = new URLSearchParams();
      if (provider) qs.set("provider", provider);
      if (refresh) qs.set("refresh", "1");
      try {
        const res = await fetch(`/api/models${qs.size ? `?${qs}` : ""}`, { credentials: "same-origin" });
        const body = (await res.json().catch(() => null)) as ModelsResponse | { error?: { message?: string } } | null;
        if (!res.ok || !body || !("providers" in body)) {
          const msg = (body && "error" in body && body.error?.message) || t("Catalog not reachable (HTTP {status})", { status: res.status });
          const patch = live ? { warning: msg, unavailable: false } : { warning: null, unavailable: true };
          setCatalog((c) => ({ ...c, ...Object.fromEntries(targets.map((p) => [p, { ...c[p], loading: false, ...patch }])) }));
          return;
        }
        setCatalog((c) => {
          const next = { ...c };
          for (const p of body.providers)
            next[p.provider] = { provider: p.provider, models: p.models, fetchedAt: p.fetched_at, source: p.source, warning: p.warning ?? null, loading: false, unavailable: false };
          return next;
        });
        if (refresh) {
          const fresh = body.providers.filter((p) => p.source === "live");
          showToast(fresh.length ? t("Model catalog updated") : t("Catalog from the cache, update not possible"));
        }
      } catch {
        setCatalog((c) => ({ ...c, ...Object.fromEntries(targets.map((p) => [p, { ...c[p], loading: false, ...(live ? { warning: t("Catalog not reachable") } : { unavailable: true }) }])) }));
      }
    },
    [live, showToast],
  );

  useEffect(() => {
    void getAiKeyStatus().then(setKeys);
    void load();
  }, [load]);

  return { catalog, keys, live, refresh: (p: AiProvider) => load(p, true) };
}
