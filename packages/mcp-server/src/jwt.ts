import { createHmac } from "node:crypto";

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/**
 * Mints a short-lived HS256 JWT that makes PostgREST, Storage and Realtime treat the caller as
 * `userId` (role authenticated, RLS applies). Shared by the MCP server and the web app's
 * POST /api/sync/session (desktop vault sync); subpath export `@kortex/mcp-server/jwt`.
 */
export function mintUserJwt(secret: string, userId: string, ttlSeconds = 600, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      iat,
      exp: iat + ttlSeconds,
    }),
  );
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return { token: `${head}.${body}.${sig}`, expiresAtMs: (iat + ttlSeconds) * 1000 };
}
