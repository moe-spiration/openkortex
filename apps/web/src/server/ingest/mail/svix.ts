import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Resend signs webhooks with Svix: headers `svix-id`, `svix-timestamp` (unix seconds) and
 * `svix-signature` (space-separated `v1,<base64 HMAC-SHA256>`, several during secret rotation).
 * Signed content: `${id}.${timestamp}.${rawBody}`. Key: the base64 part of the `whsec_…` secret.
 * Fail-closed: anything missing, malformed, stale or not matching is rejected.
 */

export const SVIX_TOLERANCE_SEC = 5 * 60;

export type SvixResult = { ok: true } | { ok: false; reason: string };

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export const svixHeaders = (h: Headers): SvixHeaders => ({
  id: h.get("svix-id") ?? h.get("webhook-id"),
  timestamp: h.get("svix-timestamp") ?? h.get("webhook-timestamp"),
  signature: h.get("svix-signature") ?? h.get("webhook-signature"),
});

function secretKey(secret: string): Buffer | null {
  const b64 = secret.trim().replace(/^whsec_/, "");
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
  const key = Buffer.from(b64, "base64");
  return key.length >= 16 ? key : null;
}

export function signSvix(secret: string, id: string, timestamp: string, body: string): string {
  const key = secretKey(secret);
  if (!key) throw new Error("invalid webhook secret");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifySvix(
  secret: string | null | undefined,
  headers: SvixHeaders,
  body: string,
  now: Date,
  toleranceSec = SVIX_TOLERANCE_SEC,
): SvixResult {
  const key = secret ? secretKey(secret) : null;
  if (!key) return { ok: false, reason: "secret missing or malformed" };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "signature headers missing" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > toleranceSec)
    return { ok: false, reason: "timestamp outside tolerance" };
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  for (const part of signature.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "signature mismatch" };
}
