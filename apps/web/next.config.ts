import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// App version shown in Settings, from this package.json at build time.
const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";

// Data source of the workspace (see src/lib/supabase/config.ts): `KORTEX_DATA_SOURCE=mock|supabase`,
// default supabase when the public Supabase keys are set. Inlined so the browser knows the mode
// at import time (src/lib/workspace-data.ts).
const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim());
const dataSource = process.env.KORTEX_DATA_SOURCE?.trim().toLowerCase() === "mock" || !hasSupabase ? "mock" : "supabase";

// Content-Security-Policy. Next injects inline bootstrap scripts, so script-src needs
// 'unsafe-inline' (a per-request nonce would force every page dynamic); 'unsafe-eval' is dev-only
// (React refresh). The browser talks to Supabase (REST/Auth/Storage + realtime websocket) only;
// AI providers (Anthropic, OpenRouter, Eden AI) are called server-side and need no entry here.
const standalone = process.env.NEXT_OUTPUT === "standalone";
const isDev = process.env.NODE_ENV !== "production";
// No Supabase URL (mock mode) or an unparsable one: nothing extra is allowed.
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // ipc: / http://ipc.localhost: the Windows app's command channel (Orbit-Bar meeting, lib/shell/desktop-bridge.ts);
  // blocked, Tauri falls back to its slower postMessage channel.
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs} ipc: http://ipc.localhost${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  "worker-src 'self' blob:", // pdf.js worker
  "frame-src 'self' blob: data:", // epub.js renders into srcdoc frames
  "media-src 'self' blob: data: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone) for the Docker image (set NEXT_OUTPUT=standalone, the
  // Dockerfile does). Off by default: on Windows the standalone copy needs symlink privileges and
  // fails local builds. The monorepo root is traced so workspace packages are included.
  ...(standalone ? { output: "standalone" as const, outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)) } : {}),
  poweredByHeader: false,
  transpilePackages: ["@kortex/db", "@kortex/i18n", "@kortex/ai-core", "@kortex/mcp-server", "@kortex/theme-packs", "@kortex/ui"],
  // Loaded by Node at runtime instead of being bundled: linkedom's CSS object model
  // (@acemir/cssom) has circular modules that broke when webpack bundled them into the server
  // chunks ("reading 'prototype'" in production, taking every server action down with it). The
  // standalone output traces these packages into node_modules.
  serverExternalPackages: ["linkedom", "@acemir/cssom"],
  env: { NEXT_PUBLIC_KORTEX_DATA_SOURCE: dataSource, NEXT_PUBLIC_KORTEX_VERSION: version },
  experimental: {
    // Client router cache (fx2-perf): every workspace page is dynamic (per-user data), and Next 15 keeps dynamic pages
    // for 0 s by default, so going back to a page waited for the server again. 30 s makes back/forth between views
    // instant; the views show client-side store data, and router.refresh() / server actions still refetch at once.
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    // HSTS only makes sense in production over https; everything else applies everywhere.
    const list = isDev ? securityHeaders.filter((h) => h.key !== "Strict-Transport-Security") : securityHeaders;
    return [
      { source: "/:path*", headers: list },
      // Theme-pack images are requested with ?v=<sha of the file> (packages/theme-packs), so a changed file gets a new URL.
      { source: "/theme-packs/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
