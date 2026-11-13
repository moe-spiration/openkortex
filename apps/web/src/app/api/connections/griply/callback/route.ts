import { NextResponse } from "next/server";
import { feature } from "@/i18n";
import { getSession, isAllowed } from "@/lib/supabase/server";
import { griplyIo } from "@/server/griply/io";
import { finishGriplyConnect } from "@/server/griply/service";

// Griply sends the user back here after the sign-in (?code=&state=). The session cookie says who it
// is, the state must match the one saved when the sign-in started. Then back to the settings.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!feature("griply")) return new NextResponse(null, { status: 404 });
  const url = new URL(request.url);
  const back = (result: "connected" | "failed") => {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
    const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    return NextResponse.redirect(`${proto}://${host}/settings?section=connectors&griply=${result}`, { headers: { "cache-control": "no-store" } });
  };
  try {
    const session = await getSession();
    if (!session || !(await isAllowed(session))) return back("failed");
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    await finishGriplyConnect(griplyIo(), session.user.id, code, state);
    return back("connected");
  } catch (err) {
    console.error("[kortex] griply callback failed:", err instanceof Error ? err.message : String(err));
    return back("failed");
  }
}
