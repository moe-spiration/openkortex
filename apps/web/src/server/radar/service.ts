import { t } from "@/i18n";
import { generateText } from "ai";
import { z } from "zod";
import { fetchPageSnapshot, modelFor, type CatalogModel, type FetchLike, type ModelRouter, type PageSnapshot } from "@kortex/ai-core";
import type { Json } from "@kortex/db";
import { WATCH_BLOCKED, isWatchableUrl, parseWatch, watchDue, type WatchState } from "@/lib/radar";
import { modelSettingsFor } from "../chat/handler";
import type { ServerDeps } from "../deps";
import { budgetStatus, withUsageContext } from "../limits/usage";
import { getUserSettings } from "../repo";
import { runWithLocale } from "@/i18n/server";
import { userLocale } from "../locale";
import { diffSystem, appendChangeEntry, countSummary, diffPrompt, diffSnapshots, snapshotText, textHash } from "./diff";

/*
 * Delta radar cron (POST /api/cron/radar, hourly like the digest cron, same X-Kortex-Cron-Secret).
 * Per run at most `limit` watched URL items (metadata.watch.enabled) of allowlisted users whose interval
 * has passed are fetched (fetchPageSnapshot: public hosts only, robots.txt, timeouts). First check = baseline
 * (no diff). Later: unchanged text only moves last_checked_at; changed text gets a short German summary on the
 * user's `summarize` route (one cheap call; without budget or on failure a line count) in metadata.watch.last_diff
 * and a bullet in the item's "## Änderungen" section. A page that blocks us is marked
 * `status: "nicht beobachtbar"` with the reason and is retried at the next interval. Never silent.
 */

export const CronRadarRequestSchema = z.object({
  /** Check watched items even when their interval has not passed (manual run, tests). */
  force: z.boolean().default(false),
  user_ids: z.array(z.string().uuid()).max(100).optional(),
  /** Report what is due without fetching anything. */
  dry_run: z.boolean().default(false),
  /** Pages per call; the rest is picked up by the next hourly call. */
  limit: z.number().int().min(1).max(50).default(20),
});
export type CronRadarRequest = z.infer<typeof CronRadarRequestSchema>;

export interface RadarResult {
  item_id: string;
  user_id: string;
  status: "baseline" | "unchanged" | "changed" | "nicht beobachtbar" | "due" | "error";
  reason?: string;
}

export interface CronRadarResponse {
  ok: true;
  now: string;
  checked: number;
  results: RadarResult[];
}

export interface RadarDeps {
  /** Page reader; tests inject a fake. */
  fetchPage?: (url: string) => Promise<PageSnapshot>;
  /** HTTP for the default page reader. */
  fetch?: FetchLike;
}

interface WatchedRow {
  id: string;
  user_id: string;
  title: string;
  content_md: string;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** The new `metadata.watch` after a successful read; `diff` is set only when the text changed. */
export function nextWatch(prev: WatchState, text: string, now: Date, diff?: WatchState["last_diff"]): WatchState {
  return {
    ...prev,
    status: "ok",
    reason: null,
    last_hash: textHash(text),
    last_checked_at: now.toISOString(),
    snapshot: text,
    ...(diff ? { last_diff: diff } : {}),
  };
}

export async function runRadar(deps: ServerDeps, req: CronRadarRequest, radar: RadarDeps = {}): Promise<CronRadarResponse> {
  const svc = deps.clients.service();
  const now = deps.now();
  const read = radar.fetchPage ?? ((url: string) => fetchPageSnapshot(url, { fetch: radar.fetch }));

  let allowed = svc.from("allowed_users").select("user_id").order("user_id").limit(1000);
  if (req.user_ids?.length) allowed = allowed.in("user_id", req.user_ids);
  const { data: users, error } = await allowed;
  if (error) throw new Error(`radar: load allowlist: ${error.message}`);
  const ids = (users ?? []).map((u) => u.user_id as string);
  if (!ids.length) return { ok: true, now: now.toISOString(), checked: 0, results: [] };

  const { data: rows, error: rErr } = await svc
    .from("knowledge_items")
    .select("id,user_id,title,content_md,source_url,metadata")
    .in("user_id", ids)
    .eq("metadata->watch->>enabled", "true")
    .neq("status", "archived")
    .limit(500);
  if (rErr) throw new Error(`radar: load watched items: ${rErr.message}`);

  const due = ((rows ?? []) as WatchedRow[])
    .map((row) => ({ row, watch: parseWatch(row.metadata) }))
    .filter((x): x is { row: WatchedRow; watch: WatchState } => !!x.watch && (req.force || watchDue(x.watch, now)))
    // Never-checked first, then the longest waiting.
    .sort((a, b) => (a.watch.last_checked_at ?? "").localeCompare(b.watch.last_checked_at ?? ""))
    .slice(0, req.limit);

  const results: RadarResult[] = [];
  if (req.dry_run) {
    for (const { row } of due) results.push({ item_id: row.id, user_id: row.user_id, status: "due" });
    return { ok: true, now: now.toISOString(), checked: ids.length, results };
  }

  const catalog = due.length ? await deps.loadCatalog() : [];
  const routers = new Map<string, Promise<{ models: ModelRouter | null; exceeded: boolean }>>();
  const modelsFor = (userId: string, cat: readonly CatalogModel[]) => {
    let p = routers.get(userId);
    if (!p) {
      p = (async () => {
        const budget = await budgetStatus(deps, userId).catch(() => null);
        if (budget?.exceeded) return { models: null, exceeded: true };
        const settings = await getUserSettings(svc, userId);
        return { models: deps.createModels(modelSettingsFor(settings, undefined, cat), cat), exceeded: false };
      })().catch(() => ({ models: null, exceeded: false }));
      routers.set(userId, p);
    }
    return p;
  };

  // The summary, the reasons and the section heading are written for the item's owner: in their language.
  const locales = new Map<string, ReturnType<typeof userLocale>>();
  const localeFor = (userId: string) => {
    let p = locales.get(userId);
    if (!p) locales.set(userId, (p = userLocale(svc, userId)));
    return p;
  };

  for (const { row, watch } of due) {
    const out = (status: RadarResult["status"], reason?: string) =>
      results.push({ item_id: row.id, user_id: row.user_id, status, ...(reason ? { reason } : {}) });
    const save = async (next: WatchState, contentMd?: string) => {
      const metadata = { ...(row.metadata ?? {}), watch: next } as unknown as Json;
      const { error: uErr } = await svc
        .from("knowledge_items")
        .update({ metadata, ...(contentMd !== undefined ? { content_md: contentMd } : {}) })
        .eq("user_id", row.user_id)
        .eq("id", row.id);
      if (uErr) throw new Error(uErr.message);
    };
    const check = async (): Promise<void> => {
      if (!isWatchableUrl(row.source_url)) {
        await save({ ...watch, status: WATCH_BLOCKED, reason: t("No valid address (http/https only)"), last_checked_at: now.toISOString() });
        out(WATCH_BLOCKED, t("No valid address"));
        return;
      }
      const page = await read(row.source_url);
      if (!page.ok) {
        await save({ ...watch, status: WATCH_BLOCKED, reason: page.reason, last_checked_at: now.toISOString() });
        out(WATCH_BLOCKED, page.reason);
        return;
      }
      const text = snapshotText(page.markdown);
      if (!text) {
        await save({ ...watch, status: WATCH_BLOCKED, reason: t("The page returns no text"), last_checked_at: now.toISOString() });
        out(WATCH_BLOCKED, t("The page returns no text"));
        return;
      }
      if (!watch.last_hash || watch.snapshot == null) {
        await save(nextWatch(watch, text, now));
        out("baseline");
        return;
      }
      if (textHash(text) === watch.last_hash) {
        await save(nextWatch({ ...watch, snapshot: watch.snapshot }, watch.snapshot, now));
        out("unchanged");
        return;
      }
      const diff = diffSnapshots(watch.snapshot, text);
      if (!diff.addedCount && !diff.removedCount) {
        // Same lines in another order: nothing to report.
        await save(nextWatch(watch, text, now));
        out("unchanged");
        return;
      }
      let summary = countSummary(diff);
      const { models } = await modelsFor(row.user_id, catalog);
      if (models) {
        try {
          const r = await withUsageContext({ userId: row.user_id }, () =>
            generateText({ model: modelFor(models, "summarize"), system: diffSystem(), prompt: diffPrompt(row.title, diff), temperature: 0.2 }),
          );
          if (r.text.trim()) summary = r.text.trim().replace(/\s+/g, " ").slice(0, 400);
        } catch (err) {
          deps.log.error(`radar summary ${row.id}`, err);
        }
      }
      const last_diff = { at: now.toISOString(), summary, added: diff.added, removed: diff.removed };
      await save(nextWatch(watch, text, now, last_diff), appendChangeEntry(row.content_md, now.toISOString().slice(0, 10), summary));
      out("changed");
    };
    try {
      await runWithLocale(await localeFor(row.user_id), check);
    } catch (err) {
      deps.log.error(`radar ${row.id}`, err);
      out("error", message(err));
    }
  }
  return { ok: true, now: now.toISOString(), checked: ids.length, results };
}
