import { t } from "../i18n";
import { createKortexClient, type KortexClient } from "@kortex/db";

/*
 * Token mode (desktop sidecar): the daemon holds only the user's personal `kx_` token with the
 * scope `sync`. `POST /api/sync/session` trades it for a short-lived Supabase access token of that
 * user, so every query, upload and Realtime channel runs under RLS as the user. No service-role key
 * ever reaches the PC.
 */

export interface SyncSessionResponse {
  ok: true;
  access_token: string;
  /** Epoch ms. */
  expires_at: number;
  user_id: string;
  supabase_url: string;
  anon_key: string;
}

export class TokenAuthError extends Error {
  override name = "TokenAuthError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The server has no vault sync (web app older than 0.6.0: 404) or it is not configured there (503). */
export class SyncUnavailableError extends Error {
  override name = "SyncUnavailableError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface TokenSessionOptions {
  apiUrl: string;
  token: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Refresh this long before expiry. Default 5 min. */
  refreshMarginMs?: number;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export class TokenSession {
  private current: SyncSessionResponse | null = null;
  private inflight: Promise<SyncSessionResponse> | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly o: TokenSessionOptions) {
    this.fetchFn = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
  }

  get apiUrl(): string {
    return trimSlash(this.o.apiUrl);
  }

  get token(): string {
    return this.o.token;
  }

  /** The session, refreshed when it is about to expire (concurrent callers share one request). */
  async session(): Promise<SyncSessionResponse> {
    const margin = this.o.refreshMarginMs ?? 5 * 60_000;
    if (this.current && this.current.expires_at - this.now() > margin) return this.current;
    this.inflight ??= this.fetchSession().finally(() => {
      this.inflight = null;
    });
    try {
      this.current = await this.inflight;
    } catch (error) {
      // Keep using a token that is still valid when only the refresh failed (network blip).
      if (error instanceof TokenAuthError || error instanceof SyncUnavailableError || !this.current || this.current.expires_at <= this.now()) throw error;
    }
    return this.current;
  }

  async accessToken(): Promise<string> {
    return (await this.session()).access_token;
  }

  private async fetchSession(): Promise<SyncSessionResponse> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.apiUrl}/api/sync/session`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.o.token}`, "content-type": "application/json" },
        body: "{}",
      });
    } catch (error) {
      throw new Error(`sync session: ${error instanceof Error ? error.message : String(error)}`);
    }
    const body = (await res.json().catch(() => null)) as
      | (Partial<SyncSessionResponse> & { error?: { message?: string } | string })
      | null;
    if (!res.ok || !body?.access_token) {
      const msg =
        (typeof body?.error === "string" ? body.error : body?.error?.message) ?? `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new TokenAuthError(msg, res.status);
      if (res.status === 404) throw new SyncUnavailableError(t("The server does not know the vault sync yet (web app 0.6.0 or later)"), 404);
      if (res.status === 503) throw new SyncUnavailableError(msg, 503);
      throw new Error(`sync session: ${msg}`);
    }
    return body as SyncSessionResponse;
  }
}

/** Supabase client that acts as the token's owner (anon key + the minted access token, RLS). */
export async function createTokenClient(session: TokenSession): Promise<{ client: KortexClient; userId: string; supabaseUrl: string }> {
  const s = await session.session();
  const client = createKortexClient(s.supabase_url, s.anon_key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: () => session.accessToken(),
  });
  return { client, userId: s.user_id.toLowerCase(), supabaseUrl: s.supabase_url };
}
