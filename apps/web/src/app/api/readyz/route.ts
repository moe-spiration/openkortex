import { NextResponse } from "next/server";
import { createKortexClient } from "@kortex/db";
import { dataSource, supabaseServerGlobal } from "@/lib/supabase/config";
import { log, requestId } from "@/lib/log";
import { readServerEnv } from "@/server/env";

// Readiness: required env present (names only, never values) and the database answers a cheap
// query. 503 until both hold, so the proxy does not route traffic to a half-configured instance.
// A missing AI key is no reason for 503: capturing and writing work without one. It is reported
// as `checks.ai: "none"` with a warning.
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 4000;

export async function GET(request: Request) {
  const rid = requestId(request);
  const headers = { "cache-control": "no-store", "x-request-id": rid };

  if (dataSource() === "mock") {
    return NextResponse.json(
      { ok: true, mode: "mock", checks: { env: "skipped", db: "skipped" } },
      { headers },
    );
  }

  const env = readServerEnv();
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const ai = env.anthropicApiKey || env.openrouterApiKey || env.edenaiApiKey ? "ok" : "none";
  const warnings =
    ai === "none"
      ? [
          "no AI key (ANTHROPIC_API_KEY|OPENROUTER_API_KEY|EDENAI_API_KEY): summaries, tags, search by meaning and chat are off",
        ]
      : undefined;
  if (missing.length > 0) {
    log.warn("readyz: env incomplete", { rid, missing });
    return NextResponse.json(
      { ok: false, checks: { env: "missing", db: "skipped", ai }, missing, warnings },
      { status: 503, headers },
    );
  }

  try {
    // Service role when configured, else the anon key: with RLS an empty result still proves the
    // database and PostgREST answer.
    const key = env.supabaseServiceRoleKey ?? env.supabaseAnonKey!;
    const client = createKortexClient(env.supabaseUrl!, key, {
      ...supabaseServerGlobal(),
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client
      .from("user_settings")
      .select("user_id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw new Error(error.message);
    return NextResponse.json(
      { ok: true, mode: "supabase", checks: { env: "ok", db: "ok", ai }, warnings },
      { headers },
    );
  } catch (err) {
    log.error("readyz: database check failed", { rid, err });
    return NextResponse.json(
      { ok: false, checks: { env: "ok", db: "unreachable", ai }, warnings },
      { status: 503, headers },
    );
  }
}
