"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { embed } from "ai";
import { embeddingModelKeyFor } from "@kortex/ai-core";
import type { ActionResult } from "@/lib/api/actions";
import { dataSource } from "@/lib/supabase/config";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";
import { modelSettingsFor } from "../chat/handler";
import { getServerDeps } from "../deps";
import { getUserSettings } from "../repo";
import { createDbBriefingCache, getBriefing, type BriefingCache } from "./briefing";
import {
  loadHomeData,
  loadMeeting,
  loadMixes,
  type EmbedQuery,
  type HomeClock,
  type HomeCtx,
} from "./service";
import type { BriefingSummary, HomeBriefing, HomeData, HomeMeeting, HomeMix } from "./types";

/*
 * Server actions of the live Home dashboard. Run as the signed-in user (RLS) and filter by
 * user_id. Never throw to the client: `{ ok: false, error }` instead.
 */

// Briefings live in kortex.user_insights (per user and day); on globalThis only for the memory layer.
const g = globalThis as { __kortexBriefingStore?: BriefingCache };
const briefingCache = (g.__kortexBriefingStore ??= createDbBriefingCache());
const DAY_MS = 86_400_000;

function validTimeZone(tz: unknown): string {
  if (typeof tz === "string" && tz.length <= 64) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    } catch {
      /* fall through */
    }
  }
  return "Europe/Berlin";
}

/** The client's local day; refused when it is more than a day away from the server clock. */
function clockOf(input: { date?: unknown; timeZone?: unknown }): HomeClock {
  const now = new Date();
  const date =
    typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  if (!date || Math.abs(Date.parse(`${date}T12:00:00Z`) - now.getTime()) > 2 * DAY_MS)
    throw new Error(t("Invalid date"));
  return { today: date, timeZone: validTimeZone(input.timeZone), now };
}

async function run<T>(what: string, fn: (ctx: HomeCtx) => Promise<T>): Promise<ActionResult<T>> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock") return { ok: false, error: t("Mock mode") };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    return { ok: true, data: await fn({ client: session.client, userId: session.user.id }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kortex] ${what} failed:`, message);
    return { ok: false, error: message };
  }
}

const logError = (m: string, err?: unknown) =>
  console.error(`[kortex] home: ${m}`, err instanceof Error ? err.message : (err ?? ""));

/** Router of the user's ADR-06 routing (reads only: never pins an embedding model). */
async function userModels(ctx: HomeCtx) {
  const deps = getServerDeps();
  const [settings, catalog] = await Promise.all([
    getUserSettings(ctx.client, ctx.userId),
    deps.loadCatalog(),
  ]);
  return {
    settings,
    models: deps.createModels(modelSettingsFor(settings, undefined, catalog), catalog),
  };
}

/** "Weiter, wo Du warst", "Wiederentdecken", Smart Mixes and today's meeting. */
export async function getHomeData(input: {
  date: string;
  timeZone?: string;
}): Promise<ActionResult<HomeData>> {
  return run("getHomeData", async (ctx) => {
    const clock = clockOf(input);
    // Vector side of the rediscover search only once the user has vectors (embedding_lock set).
    let embedQuery: EmbedQuery | undefined;
    try {
      const { settings, models } = await userModels(ctx);
      if (settings?.embedding_lock) {
        embedQuery = async (text) => {
          try {
            const { embedding } = await embed({
              model: models.embedding(),
              value: text.slice(0, 4000),
            });
            const modelKey = embeddingModelKeyFor(models);
            return modelKey ? { embedding, modelKey } : null;
          } catch (err) {
            logError("rediscover embedding failed, full-text only", err);
            return null;
          }
        };
      }
    } catch (err) {
      logError("no model router, rediscover uses full-text only", err);
    }
    return loadHomeData(ctx, clock, embedQuery, (part, err) => logError(`${part} failed`, err));
  });
}

/**
 * Today's briefing: the sentence is generated at most once per day (summarize route); the tasks
 * are fresh. `cached` is the client's stored copy for the same day, used after a server restart.
 */
export async function getHomeBriefing(input: {
  date: string;
  timeZone?: string;
  cached?: BriefingSummary | null;
}): Promise<ActionResult<HomeBriefing>> {
  return run("getHomeBriefing", async (ctx) =>
    getBriefing(ctx, clockOf(input), {
      cache: briefingCache,
      models: async () => (await userModels(ctx)).models,
      clientCopy: input.cached ?? null,
      log: logError,
    }),
  );
}

/** Smart Mixes only (Spaces renders them without the rest of Home). */
export async function getHomeMixes(): Promise<ActionResult<HomeMix[]>> {
  return run("getHomeMixes", (ctx) => loadMixes(ctx));
}

/** The most recent meeting item of the last 24 hours, or null (feeds the meeting card). */
export async function getHomeMeeting(input: {
  date: string;
  timeZone?: string;
}): Promise<ActionResult<HomeMeeting | null>> {
  return run("getHomeMeeting", (ctx) => loadMeeting(ctx, clockOf(input)));
}
