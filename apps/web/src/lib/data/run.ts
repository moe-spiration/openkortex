import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import type { KortexClient } from "@kortex/db";
import { timeZone } from "@/lib/supabase/config";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";
import { loadLifeSource, type LifeSource } from "@/server/life/source";

/*
 * Shared plumbing of the Life / Insights / Review server actions: the signed-in user's session
 * (RLS) plus an explicit user_id filter in every query. Results never throw to the client.
 */

export type DataResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type DataCtx = { client: KortexClient; userId: string; timeZone: string; now: Date };

export async function runData<T>(
  what: string,
  fn: (ctx: DataCtx) => Promise<T>,
): Promise<DataResult<T>> {
  enterRequestLocale(await requestLocale());
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    return {
      ok: true,
      data: await fn({
        client: session.client,
        userId: session.user.id,
        timeZone: timeZone(),
        now: new Date(),
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kortex] ${what} failed:`, message);
    return { ok: false, error: message };
  }
}

export const sourceFor = (ctx: DataCtx): Promise<LifeSource> =>
  loadLifeSource(ctx.client, ctx.userId, { now: ctx.now, timeZone: ctx.timeZone });
