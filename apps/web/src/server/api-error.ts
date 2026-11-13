import { t } from "@/i18n";
import { ZodError } from "zod";

/**
 * Error codes shared by every route. The first six match the browser extension's
 * `IngestErrorCode` (apps/extension/src/lib/api.ts), so it can handle them as-is.
 */
export type ApiErrorCode =
  | "not_configured"
  | "unauthorized"
  | "invalid_request"
  | "rate_limited"
  | "server_error"
  | "not_found"
  /** S2a: signed in, but not on the Kortex allowlist. */
  | "no_access"
  /** S2a: the daily AI budget (user_settings.daily_ai_budget_eur) is used up. */
  | "budget_exceeded";

/** Every non-2xx JSON response has this shape. */
export interface ApiFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

const STATUS: Record<ApiErrorCode, number> = {
  not_configured: 503,
  unauthorized: 401,
  invalid_request: 400,
  rate_limited: 429,
  server_error: 500,
  not_found: 404,
  no_access: 403,
  budget_exceeded: 402,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.status = options.status ?? STATUS[code];
    this.details = options.details;
  }
  readonly details: unknown;
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError("invalid_request", message, { details });
export const unauthorized = (message = t("Not signed in")) => new ApiError("unauthorized", message);
export const forbidden = (message: string) =>
  new ApiError("unauthorized", message, { status: 403 });
export const notFound = (message = t("Not found")) => new ApiError("not_found", message);

export function json<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** Maps any thrown value to the consistent `{ ok: false, error }` shape. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return badRequest(`${where}${first ? t(first.message) : "invalid request"}`, err.issues);
  }
  return new ApiError("server_error", t("Internal error"), { cause: err });
}

export function errorResponse(err: ApiError, headers?: HeadersInit): Response {
  const body: ApiFailure = {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
  return json(body, { status: err.status, headers });
}
