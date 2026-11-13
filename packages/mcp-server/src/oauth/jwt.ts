import { createHmac, timingSafeEqual } from "node:crypto";

// Minimal HS256 JWTs for the tokens this server issues (authorization codes, access and refresh
// tokens, stateless client ids) and for verifying Supabase user JWTs. No `alg` negotiation: the
// header must say HS256, so "none" and algorithm-confusion tokens are rejected.

export type Claims = Record<string, unknown> & {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  jti?: string;
};

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");
const json = (v: unknown) => b64url(JSON.stringify(v));

export function signJwt(secret: string, claims: Claims, header: Record<string, string> = {}): string {
  const head = json({ alg: "HS256", typ: "JWT", ...header });
  const body = json(claims);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export type VerifyFailure = "malformed" | "signature" | "expired" | "not_yet_valid" | "type";

export type VerifyResult =
  | { ok: true; claims: Claims; header: Record<string, unknown> }
  | { ok: false; reason: VerifyFailure };

export interface VerifyOptions {
  /** Expected `typ` header (e.g. `at+jwt`); omitted = any. */
  typ?: string;
  nowMs?: number;
  /** Allowed clock skew in seconds for exp/nbf. */
  skewSeconds?: number;
}

export function verifyJwt(secret: string, token: string, opts: VerifyOptions = {}): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return { ok: false, reason: "malformed" };
  const [head, body, sig] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Claims;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "HS256" || typeof claims !== "object" || claims === null) {
    return { ok: false, reason: "malformed" };
  }
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature" };
  }
  if (opts.typ !== undefined && header.typ !== opts.typ) return { ok: false, reason: "type" };
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const skew = opts.skewSeconds ?? 5;
  if (typeof claims.exp !== "number" || claims.exp + skew < now) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf - skew > now) return { ok: false, reason: "not_yet_valid" };
  return { ok: true, claims, header };
}

export const audienceIncludes = (aud: Claims["aud"], wanted: string) =>
  Array.isArray(aud) ? aud.includes(wanted) : aud === wanted;
