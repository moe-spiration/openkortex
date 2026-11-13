#!/usr/bin/env node
/**
 * Explicit switch of the embedding model for KORTEX_USER_ID:
 *
 *   pnpm --filter @kortex/md-sync reembed                      # dry run: what would change
 *   pnpm --filter @kortex/md-sync reembed -- --to openrouter:<model> --yes
 *
 * Without `--to` the target is the exact model in ai_routing_config.embeddings (Settings →
 * KI-Modelle & Routing), if it differs from the pinned one. The target must be a 1536-dim
 * embedding model in the catalog (`--force` skips that check). Rewrites every chunk vector, then
 * moves kortex.user_settings.embedding_lock. Costs: one embedding call per chunk batch.
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, KORTEX_USER_ID and
 * the target provider's key (OPENROUTER_API_KEY or EDENAI_API_KEY).
 */
import { applyUserLocale } from "./i18n";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reembedUser } from "@kortex/ai-core";
import {
  createKortexClient,
  EMBEDDING_PROVIDERS,
  embeddingModelKey,
  loadRoutingContext,
  modelServesTask,
  type EmbeddingProvider,
} from "@kortex/db";
import { loadEnvFiles } from "./config";
import { isUuid } from "./paths";

const fail = (msg: string): never => {
  console.error(`reembed: ${msg}`);
  process.exit(2);
};

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  loadEnvFiles([path.resolve(here, "../../../.env.local"), path.resolve(here, "../../../.env")]);
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const yes = args.includes("--yes");
  const force = args.includes("--force");
  const toArg = args[args.indexOf("--to") + 1];

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.KORTEX_USER_ID?.trim().toLowerCase() ?? "";
  if (!url || !key) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (!isUuid(userId)) fail("KORTEX_USER_ID must be the Supabase auth user uuid");

  const client = createKortexClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await applyUserLocale(client, userId);
  const ctx = await loadRoutingContext(client, userId);

  let target: { provider: EmbeddingProvider; model_id: string };
  if (args.includes("--to")) {
    const v = toArg ?? "";
    const colon = v.indexOf(":");
    const provider = v.slice(0, colon) as EmbeddingProvider;
    if (colon < 1 || !EMBEDDING_PROVIDERS.includes(provider))
      fail(`--to must be <${EMBEDDING_PROVIDERS.join("|")}>:<model_id>`);
    target = { provider, model_id: v.slice(colon + 1) };
  } else {
    const r = ctx.routing.embeddings;
    if (!r.model_id) fail("no --to given and the embeddings route is on Auto: name a model");
    target = { provider: r.provider as EmbeddingProvider, model_id: r.model_id! };
  }
  const to = embeddingModelKey(target);
  console.log(`current lock: ${ctx.embeddingLock ? embeddingModelKey(ctx.embeddingLock) : "(none)"}`);
  console.log(`target:       ${to}`);
  if (ctx.embeddingLock && embeddingModelKey(ctx.embeddingLock) === to)
    console.log("target equals the current lock: only chunks without this model are rewritten");

  const known = ctx.catalog.find(
    (m) => m.provider === target.provider && m.model_id === target.model_id,
  );
  if (!known && !force) fail(`${to} is not in the model catalog (use --force to skip this check)`);
  if (known && !modelServesTask(known, "embeddings"))
    fail(`${to} is not a ${1536}-dim embedding model (embedding_dimensions=${known.embedding_dimensions})`);

  const res = await reembedUser({
    client,
    userId,
    target,
    env: process.env,
    dryRun: !yes,
    log: (m) => console.log(m),
  });
  const price = known?.pricing.input_per_mtok;
  if (price !== undefined)
    console.log(`estimated cost: ~$${((res.tokenEstimate / 1e6) * price).toFixed(4)}`);
  if (!yes) console.log("dry run: nothing written. Add --yes to re-embed and move the lock.");
  else console.log(`done: ${res.reembedded} chunks re-embedded, lock is ${to}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
