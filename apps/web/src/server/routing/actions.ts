"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { ZodError } from "zod";
import {
  DEFAULT_AI_ROUTING,
  getAiRouting as loadRouting,
  getEmbeddingLock as loadEmbeddingLock,
  updateAiRouting as saveRouting,
  type AiRoutingConfig,
  type AiRoutingPatch,
  type EmbeddingLock,
} from "@kortex/db";
import { embeddingsPatchError } from "@/lib/settings/embedding-lock";
import { dataSource } from "@/lib/supabase/config";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";

/*
 * ADR-06 routing for the settings UI (part C). Runs as the signed-in user (RLS) and filters by
 * user_id. Never throws to the client: `{ ok: false, error }` instead.
 */

export type RoutingResult = { ok: true; data: AiRoutingConfig } | { ok: false; error: string; issues?: unknown };

/** The signed-in user's task routing (defaults in mock mode or for missing tasks). */
export async function getAiRouting(): Promise<RoutingResult> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock") return { ok: true, data: { ...DEFAULT_AI_ROUTING } };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    return { ok: true, data: await loadRouting(session.client, session.user.id) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Applies a partial change, e.g. `{ chat_reasoning: { provider: "openrouter", model_id: "x" } }`
 * or `{ summarize: { model_id: null, auto_mode: "balanced" } }` (back to Auto). Switching the
 * provider without a model resets it to Auto. Returns the full saved config. A patch that touches
 * `embeddings` is refused while the user has an embedding_lock; patches for other tasks save as usual.
 */
export async function updateAiRouting(patch: AiRoutingPatch): Promise<RoutingResult> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock") return { ok: false, error: t("Mock mode: routing is not saved") };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    // Locked embeddings (vectors exist): only the md-sync re-embed may change that route.
    const locked = embeddingsPatchError(patch, await loadEmbeddingLock(session.client, session.user.id));
    if (locked) return { ok: false, error: locked };
    return { ok: true, data: await saveRouting(session.client, session.user.id, patch) };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, error: t("Invalid routing"), issues: err.issues };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type EmbeddingLockResult = { ok: true; data: EmbeddingLock | null } | { ok: false; error: string };

/** The signed-in user's embedding lock (null: nothing embedded yet, or mock mode). */
export async function getEmbeddingLockStatus(): Promise<EmbeddingLockResult> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock") return { ok: true, data: null };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    return { ok: true, data: await loadEmbeddingLock(session.client, session.user.id) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
