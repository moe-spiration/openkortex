"use client";

import { t } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_AI_ROUTING,
  TASK_PROVIDERS,
  modelServesTask,
  type AiProvider,
  type AutoMode,
  type ModelCatalogEntry,
  type TaskRoute,
} from "@kortex/db/routing";
import { isLiveData } from "@/lib/workspace-data";
import { getAiRouting, updateAiRouting } from "@/server/routing/actions";

/*
 * The footbar model selector = the user's `chat_reasoning` route (ADR-06). It reads and writes
 * user_settings.ai_routing_config through the routing server actions and offers only catalog
 * models that can serve chat (GET /api/models?task=chat_reasoning). Mock mode shows the default
 * route read-only.
 */

export const CHAT_PROVIDERS: readonly AiProvider[] = TASK_PROVIDERS.chat_reasoning;

interface ModelsBody {
  ok?: boolean;
  providers?: { provider: AiProvider; warning?: string; models: ModelCatalogEntry[] }[];
  error?: { message?: string };
}

export function useChatModel(showToast: (m: string) => void) {
  const live = isLiveData();
  const [route, setRoute] = useState<TaskRoute>(DEFAULT_AI_ROUTING.chat_reasoning);
  const [catalog, setCatalog] = useState<Partial<Record<AiProvider, ModelCatalogEntry[]>>>({});
  const [catalogState, setCatalogState] = useState<{ loading: boolean; warning: string | null }>({ loading: false, warning: null });
  const latest = useRef(route);
  latest.current = route;

  const reload = useCallback(async () => {
    const res = await getAiRouting();
    if (res.ok) setRoute(res.data.chat_reasoning);
  }, []);

  useEffect(() => {
    if (live) void reload();
  }, [live, reload]);

  const loadCatalog = useCallback(
    async (provider: AiProvider) => {
      if (!live) return;
      setCatalogState({ loading: true, warning: null });
      try {
        const res = await fetch(`/api/models?task=chat_reasoning&provider=${provider}`, { credentials: "same-origin" });
        const body = (await res.json().catch(() => null)) as ModelsBody | null;
        const p = body?.providers?.find((x) => x.provider === provider);
        if (!res.ok || !p) {
          setCatalogState({ loading: false, warning: body?.error?.message ?? t("Catalog not reachable (HTTP {status})", { status: res.status }) });
          return;
        }
        const models = p.models
          .filter((m) => m.is_available && modelServesTask(m, "chat_reasoning"))
          .sort((a, b) => (a.display_name ?? a.model_id).localeCompare(b.display_name ?? b.model_id));
        setCatalog((c) => ({ ...c, [provider]: models }));
        setCatalogState({ loading: false, warning: p.warning ?? null });
      } catch {
        setCatalogState({ loading: false, warning: t("Catalog not reachable") });
      }
    },
    [live],
  );

  /** Saves a change of the chat route (optimistic, rolls back on error). */
  const apply = useCallback(
    async (patch: Partial<TaskRoute>, done: string) => {
      if (!live) {
        showToast(t("The model is not saved in mock mode"));
        return;
      }
      const before = latest.current;
      const optimistic: TaskRoute =
        patch.provider && patch.provider !== before.provider && patch.model_id === undefined
          ? { ...before, provider: patch.provider, model_id: null }
          : { ...before, ...patch };
      setRoute(optimistic);
      const res = await updateAiRouting({ chat_reasoning: patch });
      if (res.ok) {
        setRoute(res.data.chat_reasoning);
        showToast(done);
      } else {
        setRoute(before);
        showToast(t("Not saved: {error}", { error: res.error }));
      }
    },
    [live, showToast],
  );

  return {
    live,
    route,
    catalog,
    catalogState,
    reload,
    loadCatalog,
    pickModel: (m: ModelCatalogEntry) => apply({ provider: m.provider, model_id: m.model_id }, t("Chat model: {model}", { model: m.display_name ?? m.model_id })),
    pickAuto: (mode: AutoMode) => apply({ model_id: null, auto_mode: mode }, t("Chat model: Auto")),
    pickProvider: (p: AiProvider) => apply({ provider: p }, t("Provider switched, model on Auto")),
  };
}
