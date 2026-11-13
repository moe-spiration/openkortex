import { enterRequestLocale, localeOfRequest } from "@/i18n/server";
import { t } from "@/i18n";
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, errorResponse, json, toApiError, unauthorized } from "../api-error";
import type { ServerDeps } from "../deps";
import type { DepsProvider } from "../route";
import { CronRadarRequestSchema, runRadar, type RadarDeps } from "../radar/service";
import { runStandingOrders } from "../agent/standing-cron";
import { CronDigestRequestSchema, runWeeklyDigests } from "./digest";

/*
 * Cron endpoints (server to server, no user session). The caller proves itself with the shared
 * secret in `X-Kortex-Cron-Secret` (env KORTEX_CRON_SECRET, at least 32 characters). Without a
 * configured secret the endpoints answer 503, so a missing env never opens them.
 */

export const CRON_SECRET_HEADER = "x-kortex-cron-secret";
const MIN_SECRET_LENGTH = 32;

const digest = (s: string) => createHash("sha256").update(s).digest();

export function checkCronSecret(request: Request, deps: Pick<ServerDeps, "env">): void {
  // No user here: errors answer in the caller's language (header, else English).
  if (request.headers.get("x-kortex-locale") || request.headers.get("accept-language"))
    enterRequestLocale(localeOfRequest(request.headers));
  const secret = deps.env.raw.KORTEX_CRON_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH)
    throw new ApiError(
      "not_configured",
      t("KORTEX_CRON_SECRET is not set (at least 32 characters)."),
    );
  const given = request.headers.get(CRON_SECRET_HEADER) ?? "";
  // Hash both sides: equal length for timingSafeEqual, no early exit on the first byte.
  if (!given || !timingSafeEqual(digest(given), digest(secret)))
    throw unauthorized(t("Cron secret is missing or wrong"));
}

async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("invalid_request", t("Body must be valid JSON"));
  }
}

export function createCronHandlers(getDeps: DepsProvider, radar: RadarDeps = {}) {
  return {
    /** POST /api/cron/radar — checks the watched URL items (metadata.watch) whose interval has passed. */
    radar: async (request: Request): Promise<Response> => {
      let deps: ServerDeps | undefined;
      try {
        deps = getDeps();
        checkCronSecret(request, deps);
        const req = CronRadarRequestSchema.parse(await body(request));
        const out = await runRadar(deps, req, radar);
        const counts = out.results.reduce<Record<string, number>>(
          (m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m),
          {},
        );
        deps.log.info("cron radar", { checked: out.checked, ...counts });
        return json(out);
      } catch (err) {
        const e = toApiError(err);
        if (e.code === "server_error") deps?.log.error("POST /api/cron/radar", err);
        return errorResponse(e);
      }
    },

    /** POST /api/cron/agent — starts the standing orders of the agent whose time has come. */
    agent: async (request: Request): Promise<Response> => {
      let deps: ServerDeps | undefined;
      try {
        deps = getDeps();
        checkCronSecret(request, deps);
        const out = await runStandingOrders(deps);
        deps.log.info("cron agent", { checked: out.checked, started: out.runs.filter((r) => r.status === "started").length });
        return json(out);
      } catch (err) {
        const e = toApiError(err);
        if (e.code === "server_error") deps?.log.error("POST /api/cron/agent", err);
        return errorResponse(e);
      }
    },

    /** POST /api/cron/digest — weekly digests for every user whose digest day has come. */
    digest: async (request: Request): Promise<Response> => {
      let deps: ServerDeps | undefined;
      try {
        deps = getDeps();
        checkCronSecret(request, deps);
        const req = CronDigestRequestSchema.parse(await body(request));
        const out = await runWeeklyDigests(deps, req);
        // The same hourly call also starts the standing orders of the agent (no second scheduled task).
        if (!req.dry_run) {
          const d = deps;
          d.defer(runStandingOrders(d).catch((err) => d.log.error("cron agent (with digest)", err)));
        }
        const counts = out.results.reduce<Record<string, number>>(
          (m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m),
          {},
        );
        deps.log.info("cron digest", {
          period: out.results[0]?.period,
          checked: out.checked,
          ...counts,
        });
        return json(out);
      } catch (err) {
        const e = toApiError(err);
        if (e.code === "server_error") deps?.log.error("POST /api/cron/digest", err);
        return errorResponse(e);
      }
    },
  };
}
