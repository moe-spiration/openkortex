"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { existsSync } from "node:fs";
import path from "node:path";
import { dataSource } from "@/lib/supabase/config";
import { getSession } from "@/lib/supabase/server";

/*
 * MCP server card (Settings > MCP-Server): the real local setup instead of mock values. Reads only
 * non-secret facts from the web server's env (host, port, whether MCP_BEARER_TOKEN is set) and
 * probes GET /healthz on the configured host:port. Secrets never leave the server.
 */

export interface McpStatus {
  host: string;
  port: number;
  httpUrl: string;
  /** MCP_BEARER_TOKEN is set (≥ 16 chars) in this server's env. */
  serverTokenSet: boolean;
  /** packages/mcp-server/dist/cli.mjs exists (built). */
  built: boolean;
  stdioCommand: string;
  httpCommand: string;
  /** Result of the last probe: running, not running, or not checked. */
  health: { state: "up" | "down" | "unknown"; ms: number | null; error: string | null; checkedAt: string | null };
}

const clean = (v: string | undefined) => (v && !/^<.*>$/.test(v.trim()) ? v.trim() : undefined);

/** Repo root: apps/web is the server's cwd in dev and build. */
function repoRoot(): string {
  const cwd = process.cwd();
  return path.basename(cwd) === "web" && path.basename(path.dirname(cwd)) === "apps" ? path.resolve(cwd, "../..") : cwd;
}

function config() {
  const host = clean(process.env.MCP_HTTP_HOST) ?? "127.0.0.1";
  const portRaw = Number(clean(process.env.MCP_HTTP_PORT) ?? 3333);
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536 ? portRaw : 3333;
  const root = repoRoot().replace(/\\/g, "/");
  const cli = `${root}/packages/mcp-server/dist/cli.mjs`;
  const envFile = `${root}/.env.local`;
  return {
    host,
    port,
    httpUrl: `http://${host}:${port}/mcp`,
    serverTokenSet: (clean(process.env.MCP_BEARER_TOKEN)?.length ?? 0) >= 16,
    built: existsSync(cli),
    stdioCommand: `node --env-file=${envFile} ${cli}`,
    httpCommand: `node --env-file=${envFile} ${cli} --http`,
  };
}

/** Probes GET http://host:port/healthz (1.5 s timeout). Only loopback hosts are probed. */
async function probe(host: string, port: number): Promise<McpStatus["health"]> {
  const checkedAt = new Date().toISOString();
  if (!/^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(host))
    return { state: "unknown", ms: null, error: t("Only local servers are checked"), checkedAt };
  const started = Date.now();
  try {
    const res = await fetch(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}/healthz`, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    const ms = Date.now() - started;
    return res.ok ? { state: "up", ms, error: null, checkedAt } : { state: "down", ms, error: `HTTP ${res.status}`, checkedAt };
  } catch (err) {
    const msg = err instanceof Error && err.name === "TimeoutError" ? t("No response (timeout)") : t("Not reachable");
    return { state: "down", ms: null, error: msg, checkedAt };
  }
}

/** Card data; `test` also probes the HTTP server. Signed-in users only (live mode). */
export async function getMcpStatus(test = false): Promise<{ ok: true; data: McpStatus } | { ok: false; error: string }> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock") return { ok: false, error: t("Mock mode") };
  if (!(await getSession())) return { ok: false, error: t("Not signed in") };
  const c = config();
  const health = test ? await probe(c.host, c.port) : { state: "unknown" as const, ms: null, error: null, checkedAt: null };
  return { ok: true, data: { ...c, health } };
}
