// Server-only configuration. Read lazily per request so `next build` works without secrets.

export interface ServerEnv {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  /**
   * Signs short-lived user JWTs for the desktop vault sync (POST /api/sync/session). Same value as
   * the Supabase `JWT_SECRET` and the MCP server's SUPABASE_JWT_SECRET.
   */
  supabaseJwtSecret?: string;
  /** Personal API token for the browser extension / scripts (single-user MVP). */
  apiToken?: string;
  /** Supabase user id the API token acts as. */
  apiTokenUserId?: string;
  /** Extra CORS origins besides chrome-extension:// and moz-extension://. */
  allowedOrigins: string[];
  /** ADR-06 primary keys. `CLAUDE_API_KEY` is accepted as a legacy alias of ANTHROPIC_API_KEY. */
  anthropicApiKey?: string;
  openrouterApiKey?: string;
  edenaiApiKey?: string;
  /**
   * Raw env for @kortex/ai-core (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, EDENAI_API_KEY, optional
   * direct overrides DEEPGRAM/GROQ/JINA/FIRECRAWL ...). ANTHROPIC_API_KEY is filled from the alias.
   */
  raw: Record<string, string | undefined>;
}

const clean = (v: string | undefined): string | undefined => {
  const s = v?.trim();
  // Treat `.env.example` placeholders like "<DEIN_...>" as unset.
  return s && !/^<.*>$/.test(s) ? s : undefined;
};

export function readServerEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  const anthropicApiKey = clean(env.ANTHROPIC_API_KEY) ?? clean(env.CLAUDE_API_KEY);
  return {
    supabaseUrl: clean(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL),
    supabaseAnonKey: clean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: clean(env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseJwtSecret: clean(env.SUPABASE_JWT_SECRET),
    apiToken: clean(env.KORTEX_API_TOKEN),
    apiTokenUserId: clean(env.KORTEX_API_TOKEN_USER_ID ?? env.KORTEX_USER_ID),
    allowedOrigins: (env.KORTEX_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    anthropicApiKey,
    openrouterApiKey: clean(env.OPENROUTER_API_KEY),
    edenaiApiKey: clean(env.EDENAI_API_KEY),
    raw: anthropicApiKey ? { ...env, ANTHROPIC_API_KEY: anthropicApiKey } : env,
  };
}
