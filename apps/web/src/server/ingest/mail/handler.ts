import { t } from "@/i18n";
import type { FetchLike } from "@kortex/ai-core";
import { ApiError, errorResponse, json, toApiError, unauthorized } from "../../api-error";
import type { ServerDeps } from "../../deps";
import { preflight, route, type DepsProvider } from "../../route";
import { inboundMailConfig } from "./address";
import type { ResendClient } from "./resend";
import { handleReceivedMail, type ReceivedEvent } from "./service";
import { readInboundMail } from "./settings";
import { svixHeaders, verifySvix } from "./svix";

/*
 * /api/ingest/mail
 *   POST  Resend webhook (`email.received`), server to server. Svix signature with
 *         RESEND_WEBHOOK_SECRET, fail-closed (401). Without the three env values the endpoint
 *         answers 503 and does nothing else. Every accepted, ignored (unknown address, not on the
 *         allowlist, other event) or duplicate delivery answers the same `{ ok: true }`, so the
 *         response never tells whether an address exists. 5xx/429/402 make Resend retry.
 *   GET   The signed-in user's address (mobile settings, read-only).
 */

const MAX_BODY_BYTES = 1024 * 1024;

export function createMailHandlers(
  getDeps: DepsProvider,
  options: { fetch?: FetchLike; resend?: ResendClient } = {},
) {
  return {
    POST: async (request: Request): Promise<Response> => {
      let deps: ServerDeps | undefined;
      try {
        deps = getDeps();
        const config = inboundMailConfig(deps.env.raw);
        if (!config.enabled)
          throw new ApiError(
            "not_configured",
            t("Mail to Kortex is not set up (RESEND_API_KEY, RESEND_WEBHOOK_SECRET, KORTEX_INBOUND_MAIL_DOMAIN)."),
          );
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
          throw unauthorized(t("Webhook signature invalid"));
        const body = await request.text();
        const check = verifySvix(config.webhookSecret, svixHeaders(request.headers), body, deps.now());
        if (!check.ok) {
          deps.log.info("mail webhook rejected", { reason: check.reason });
          throw unauthorized(t("Webhook signature invalid"));
        }
        let event: ReceivedEvent;
        try {
          event = JSON.parse(body) as ReceivedEvent;
        } catch {
          throw new ApiError("invalid_request", t("Body must be valid JSON"));
        }
        const out = await handleReceivedMail(deps, event, options);
        deps.log.info("mail webhook", out);
        return json({ ok: true });
      } catch (err) {
        const e = toApiError(err);
        if (e.status >= 500 && e.code !== "not_configured") deps?.log.error("POST /api/ingest/mail", err);
        return errorResponse(e);
      }
    },

    GET: route(getDeps, async ({ auth, deps }) =>
      json({ ok: true, data: await readInboundMail(auth.client, auth.userId, deps.env.raw) }),
    ),

    OPTIONS: preflight(getDeps),
  };
}
