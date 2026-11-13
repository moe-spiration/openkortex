import { NextResponse } from "next/server";

// Liveness only: the process answers. No dependencies, no auth, no secrets.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, version: process.env.NEXT_PUBLIC_KORTEX_VERSION ?? "0.0.0", uptime_s: Math.round(process.uptime()) },
    { headers: { "cache-control": "no-store" } },
  );
}
