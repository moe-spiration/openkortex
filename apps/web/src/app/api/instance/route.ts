import { NextResponse } from "next/server";
import { instanceInfo } from "@/lib/supabase/instance";

/*
 * What a client needs to know to talk to this Kortex: the Windows app, the Android app and the
 * browser extension carry no server address, they ask for one on first start and read the rest here.
 * Public by design, no auth: the Supabase URL and anon key are in every page of the web app anyway
 * (RLS and the allowlist protect the data). Nothing else belongs in this answer.
 */
export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

export function GET() {
  return NextResponse.json(instanceInfo(), { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET" } });
}
