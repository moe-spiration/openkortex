import { createAiForUser, createAiFromEnv, type AiWiring } from "./ai";
import { createSupabaseConnectionFromEnv, loadHttpConfig } from "./config";
import { InMemoryBrainRepository } from "./memory-repository";
import { createSupabasePasswordLogin } from "./oauth/auth";
import { loadOAuthConfig } from "./oauth/config";
import { createUserContextFactory } from "./oauth/context";
import { createLogger } from "./oauth/ops";
import { createOAuthProvider } from "./oauth/provider";
import type { BrainRepository } from "./repository";
import { SupabaseBrainRepository } from "./supabase-repository";
import { startHttpServer } from "./http";
import { loadUserLocale, setLocale } from "./i18n";
import { runStdio } from "./server";
import type { ToolContext } from "./tools";

// stdout is the MCP channel in stdio mode: all diagnostics go to stderr.
const log = (msg: string) => process.stderr.write(`[kortex-mcp] ${msg}\n`);

/** Remote mode (MCP_PUBLIC_URL set): OAuth 2.1 for claude.ai connectors, one RLS client per user. */
async function startRemote() {
  const cfg = loadOAuthConfig(process.env);
  if (!cfg) throw new Error("MCP_PUBLIC_URL is not set");
  const http = loadHttpConfig(process.env, { bearerOptional: true });
  const logger = createLogger();
  const provider = createOAuthProvider(cfg, {
    login: createSupabasePasswordLogin(cfg),
    log: logger,
  });
  const resolveContext = createUserContextFactory(process.env, {
    log: logger,
    staticUserId: process.env.KORTEX_USER_ID,
  });
  const supabaseHealthy = async () =>
    (
      await fetch(`${cfg.supabaseUrl}/auth/v1/health`, {
        headers: { apikey: cfg.supabaseAnonKey },
        signal: AbortSignal.timeout(4000),
      })
    ).ok;
  const running = await startHttpServer({
    oauth: { cfg, provider },
    bearerToken: http.bearerToken,
    staticUserId: process.env.KORTEX_USER_ID,
    resolveContext,
    host: http.host,
    port: http.port,
    log: logger,
    ready: supabaseHealthy,
  });
  logger.info("listening", {
    url: running.url,
    resource: cfg.resource,
    users: cfg.allowedUserIds.length,
    static_bearer: !!http.bearerToken,
  });
  return running;
}

async function main() {
  const http = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";

  if (http && process.env.MCP_PUBLIC_URL) {
    const running = await startRemote();
    const stop = () => void running.close().finally(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }

  // KORTEX_BACKEND=memory: throwaway in-memory brain to dry-run a client config without any database.
  const memory = process.env.KORTEX_BACKEND === "memory";
  let repo: BrainRepository;
  let ai: AiWiring;
  if (memory) {
    repo = new InMemoryBrainRepository();
    ai = createAiFromEnv(process.env);
  } else {
    // Same ADR-06 routing, catalog and embedding lock as the web app and md-sync. Both auth
    // modes run hybrid search (JWT: auth.uid() RPC, service role: explicit user RPC).
    const conn = createSupabaseConnectionFromEnv();
    repo = new SupabaseBrainRepository(conn);
    // Single-user process: the account's language once at start-up (no row or value: English).
    const locale = await loadUserLocale(conn.client, conn.userId);
    if (locale) setLocale(locale);
    ai = await createAiForUser(process.env, { client: conn.client, userId: conn.userId }).catch(
      (e: unknown) => ({
        notes: [`AI off (full-text search only): ${e instanceof Error ? e.message : String(e)}`],
      }),
    );
  }
  for (const note of ai.notes) log(note);
  const ctx: ToolContext = { repo, embedder: ai.embedder, enricher: ai.enricher };

  if (http) {
    const cfg = loadHttpConfig();
    const running = await startHttpServer({ ...ctx, ...cfg });
    log(`Streamable HTTP listening on ${running.url} (Bearer auth)`);
    const stop = () => void running.close().finally(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } else {
    await runStdio(ctx);
    log("stdio transport ready");
  }
}

main().catch((e: unknown) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
