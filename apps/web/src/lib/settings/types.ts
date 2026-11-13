import type { UserSettingsRow } from "@/lib/mock/settings";

/**
 * The user_settings row as the browser sees it: never the MCP token hash. The inbound mail address
 * has its own card and actions (server/ingest/mail/settings.ts), so a settings read keeps working
 * before migration 20261101100000 is applied.
 */
export type ClientUserSettings = Omit<UserSettingsRow, "mcp_token_hash" | "inbound_mail_token" | "inbound_mail_rotated_at">;

/** What the UI knows about the MCP bearer token after it was shown once. */
export interface McpTokenInfo {
  /** Last 4 characters ("••••abcd"). */
  hint: string;
  createdAt: string;
}

/** Drops the hash from a full row (mock row, or anything typed as the full row). */
export function toClientSettings(row: UserSettingsRow | ClientUserSettings): ClientUserSettings {
  const rest: Partial<UserSettingsRow> = { ...row };
  delete rest.mcp_token_hash;
  delete rest.inbound_mail_token;
  delete rest.inbound_mail_rotated_at;
  return rest as ClientUserSettings;
}
