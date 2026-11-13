import { createAiForUser, type AiWiring } from "../ai";
import { createSupabaseConnectionForUser } from "../config";
import { loadUserLocale } from "../i18n";
import { SupabaseBrainRepository } from "../supabase-repository";
import type { ToolContext } from "../tools";
import type { Logger } from "./ops";
import type { AuthInfo } from "./provider";

type Env = Record<string, string | undefined>;

const TTL_MS = 15 * 60_000;

/**
 * Tool context per authenticated user: a Supabase client that acts AS that user (a short-lived
 * minted JWT, so row level security applies and the service role is never involved) plus the user's
 * ADR-06 embedder/organizer. Cached for 15 minutes; the client re-mints its own token as needed.
 */
export function createUserContextFactory(
  env: Env,
  opts: { log?: Logger; staticUserId?: string; now?: () => number } = {},
): (auth: AuthInfo) => Promise<ToolContext> {
  const now = opts.now ?? Date.now;
  const cache = new Map<
    string,
    { at: number; ctx: Promise<ToolContext>; close: Promise<(() => Promise<void>) | undefined> }
  >();

  async function build(userId: string): Promise<{ ctx: ToolContext; close?: () => Promise<void> }> {
    const conn = createSupabaseConnectionForUser(env, userId, { requireRls: true });
    const ai: AiWiring = await createAiForUser(env, { client: conn.client, userId }).catch(
      (e: unknown) => ({ notes: [`AI off (full-text search only): ${e instanceof Error ? e.message : String(e)}`] }),
    );
    for (const note of ai.notes) opts.log?.info("user context", { user: userId.slice(0, 8), note });
    // The account's language: every request of this user runs in it (see http.ts).
    const locale = await loadUserLocale(conn.client, userId);
    return {
      ctx: {
        repo: new SupabaseBrainRepository(conn),
        embedder: ai.embedder,
        enricher: ai.enricher,
        ...(locale ? { locale } : {}),
      },
      ...(ai.close ? { close: ai.close } : {}),
    };
  }

  return (auth) => {
    // The static bearer token acts as the one configured user; OAuth/Supabase tokens carry their own.
    const userId = auth.kind === "static" ? (opts.staticUserId ?? auth.userId) : auth.userId;
    const hit = cache.get(userId);
    if (hit && now() - hit.at < TTL_MS) return hit.ctx;
    // The expired context's live routing feed (Realtime channel, timer) is stopped.
    if (hit) void hit.close.then((c) => c?.()).catch(() => undefined);
    const built = build(userId);
    const ctx = built.then((b) => b.ctx);
    cache.set(userId, { at: now(), ctx, close: built.then((b) => b.close).catch(() => undefined) });
    ctx.catch(() => cache.delete(userId));
    return ctx;
  };
}
