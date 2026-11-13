import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * MCP HTTP bearer token (server only: node:crypto). The token is 32 random bytes as base64url and
 * leaves the server exactly once, in the rotate response. kortex.user_settings keeps only
 * mcp_token_hash (SHA-256, hex), mcp_token_hint (last 4 chars) and mcp_token_created_at.
 *
 * MCP server side (packages/mcp-server, not wired yet): for an HTTP request with
 * `Authorization: Bearer <token>`, compute hashMcpToken(token), look the row up by
 * mcp_token_hash with the service role (unique partial index user_settings_mcp_token_hash_key)
 * and compare with verifyMcpToken() before acting as that row's user_id. Until then the server
 * keeps reading MCP_BEARER_TOKEN from its env.
 */

export const MCP_TOKEN_BYTES = 32;
export const MCP_TOKEN_HINT_LENGTH = 4;

export function generateMcpToken(): string {
  return randomBytes(MCP_TOKEN_BYTES).toString("base64url");
}

/** SHA-256 of the token as 64 lowercase hex chars (what mcp_token_hash stores). */
export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Last 4 characters, shown as "••••abcd". */
export function mcpTokenHint(token: string): string {
  return token.slice(-MCP_TOKEN_HINT_LENGTH);
}

/** Constant-time check of a presented token against a stored hash. */
export function verifyMcpToken(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashMcpToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Everything a rotate writes, plus the token to show once. */
export function newMcpTokenRecord(now: Date = new Date()) {
  const token = generateMcpToken();
  return {
    token,
    columns: {
      mcp_token_hash: hashMcpToken(token),
      mcp_token_hint: mcpTokenHint(token),
      mcp_token_created_at: now.toISOString(),
    },
  };
}
