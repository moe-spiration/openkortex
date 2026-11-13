import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import type { User } from "@supabase/supabase-js";
import type { KortexClient } from "@kortex/db";
import { dataSource } from "@/lib/supabase/config";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";

/* Shared runner of the WP-K server actions: signed-in user (RLS), never throws to the client. */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ActionCtx {
  client: KortexClient;
  userId: string;
  user: User;
}

export async function runAction<T>(what: string, fn: (ctx: ActionCtx) => Promise<T>): Promise<ActionResult<T>> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock") return { ok: false, error: t("Mock mode") };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    return { ok: true, data: await fn({ client: session.client, userId: session.user.id, user: session.user }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kortex] ${what} failed:`, message);
    return { ok: false, error: message };
  }
}
