"use server";

import { runAction, type ActionResult } from "@/server/settings/run";
import { createToken, deleteToken, listTokens, revokeToken } from "./store";
import type { ApiTokenRow } from "./tokens";

/* Server actions of Settings → Persönliche API-Tokens. They run as the signed-in user (RLS). */

export interface TokenListing {
  tokens: ApiTokenRow[];
  /** Server clock, so the list can show "abgelaufen" without trusting the browser's. */
  now: string;
}

export async function listApiTokens(): Promise<ActionResult<TokenListing>> {
  return runAction("api tokens list", async ({ client, userId }) => ({
    tokens: await listTokens(client, userId),
    now: new Date().toISOString(),
  }));
}

/**
 * The raw token is in the result once; it cannot be read again afterwards. `search` adds read access
 * to /api/search and live coaching (desktop launcher, HUD) on top of capture; `ask` adds the
 * launcher's "Fragen" (POST /api/chat). The settings checkbox is the desktop's read option, so
 * `ask` follows `search` unless it is given on its own. `sync` (vault sync on the PC) only comes
 * from the desktop connect flow.
 */
export async function createApiToken(
  name: string,
  expiresInDays?: number | null,
  options: { search?: boolean; ask?: boolean; sync?: boolean } = {},
): Promise<ActionResult<{ token: string; row: ApiTokenRow }>> {
  const search = options.search === true;
  const ask = options.ask ?? search;
  const sync = options.sync === true;
  return runAction("api token create", ({ client, userId }) =>
    createToken(client, userId, name, new Date(), { expiresInDays, search, ask, sync }),
  );
}

export async function revokeApiToken(id: string): Promise<ActionResult<null>> {
  return runAction("api token revoke", async ({ client, userId }) => {
    await revokeToken(client, userId, id, new Date());
    return null;
  });
}

/** Deletes a token for good (also an active one: it stops working at once). */
export async function deleteApiToken(id: string): Promise<ActionResult<null>> {
  return runAction("api token delete", async ({ client, userId }) => {
    await deleteToken(client, userId, id);
    return null;
  });
}
