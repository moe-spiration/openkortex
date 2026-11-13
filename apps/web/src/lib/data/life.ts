"use server";

import { t } from "@/i18n";
import { AREA_KEYS } from "@/server/life/areas";
import { computeLife, type LifeData } from "@/server/life/compute";
import { deleteInsight, readInsights, writeInsight } from "@/server/life/state";
import { runData, sourceFor, type DataResult } from "./run";

/*
 * Life areas, live (WP-I). See server/life/areas.ts for how items map to areas and
 * server/life/compute.ts for scores and texts. Visions live in kortex.user_insights.
 */

export type LifeLive = LifeData & { visions: Record<string, string> };

/** Sidebar row of a life area: the same computeLife() as the Life overview (one source of truth). */
export interface LifeScore {
  key: string;
  score: number;
  /** No goals, tasks, entries or routines yet (the overview shows no score either). */
  empty: boolean;
  /** Chosen in onboarding / custom_taxonomy (all six when nothing was chosen). */
  active: boolean;
}

/** Scores of all six areas for the sidebar (WP-M), computed exactly like loadLife(). */
export async function loadLifeScores(): Promise<DataResult<LifeScore[]>> {
  return runData("loadLifeScores", async (ctx) =>
    computeLife(await sourceFor(ctx)).areas.map(({ key, score, empty, active }) => ({
      key,
      score,
      empty: empty === true,
      active: active !== false,
    })),
  );
}

export async function loadLife(): Promise<DataResult<LifeLive>> {
  return runData("loadLife", async (ctx) => {
    const [src, rows] = await Promise.all([
      sourceFor(ctx),
      readInsights(ctx.client, ctx.userId, "life_vision"),
    ]);
    const visions: Record<string, string> = {};
    for (const r of rows)
      if (typeof r.payload.text === "string" && r.payload.text.trim())
        visions[r.key] = r.payload.text;
    return { ...computeLife(src), visions };
  });
}

/** Saves (or with an empty text removes) the vision of one area. */
export async function saveLifeVision(area: string, text: string): Promise<DataResult<null>> {
  return runData("saveLifeVision", async (ctx) => {
    if (!AREA_KEYS.includes(area)) throw new Error(t("Unknown life area"));
    const clean = text.trim().slice(0, 600);
    if (clean)
      await writeInsight(ctx.client, ctx.userId, {
        kind: "life_vision",
        key: area,
        payload: { text: clean },
      });
    else await deleteInsight(ctx.client, ctx.userId, "life_vision", area);
    return null;
  });
}
