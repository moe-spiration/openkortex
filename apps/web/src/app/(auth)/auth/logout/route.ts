import { NextResponse, type NextRequest } from "next/server";
import { dataSource } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Sign out: `POST /auth/logout` (form button) or `GET /auth/logout` (plain link from the profile
 * menu). Clears the Supabase session cookies and returns to the login page.
 */
async function logout(request: NextRequest) {
  if (dataSource() === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}

export const GET = logout;
export const POST = logout;
