import { msg, t } from "@/i18n";
import type { AiRoutingPatch, EmbeddingLock } from "@kortex/db/routing";

/*
 * Embedding lock rules for the routing UI and updateAiRouting. Once the user's vectors exist
 * (kortex.user_settings.embedding_lock), the embeddings route is fixed: switching the model means
 * re-embedding every chunk, which only the md-sync `reembed` CLI does (packages/md-sync/src/reembed-cli.ts).
 */

export const REEMBED_COMMAND = (target = "<provider>:<model>") =>
  `pnpm --filter @kortex/md-sync reembed -- --to ${target} --yes`;

/** English source text; `embeddingsPatchError` returns it in the current language. */
export const EMBEDDINGS_LOCKED_ERROR = msg("The embedding model is fixed; switching needs a re-index (md-sync reembed)");

/** Error when a routing patch touches the locked embeddings route, else null. */
export function embeddingsPatchError(
  patch: AiRoutingPatch | null | undefined,
  lock: EmbeddingLock | null,
): string | null {
  if (!lock || !patch || typeof patch !== "object") return null;
  return Object.prototype.hasOwnProperty.call(patch, "embeddings") ? t(EMBEDDINGS_LOCKED_ERROR) : null;
}

/** The patch without the embeddings route (e.g. "Standardwerte" while locked). */
export function withoutEmbeddings(patch: AiRoutingPatch): AiRoutingPatch {
  const rest = { ...patch };
  delete rest.embeddings;
  return rest;
}
