import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { dataSource, supabasePublicConfig, supabaseServerGlobal } from "@/lib/supabase/config";

/*
 * Refreshes the Supabase session cookie on every page request and keeps the workspace behind the
 * login. API routes are not matched: they authenticate on their own (cookie, bearer JWT or the
 * personal API token) and answer 401 as JSON instead of redirecting.
 */

const PUBLIC_PATHS = ["/login", "/auth/", "/kein-zugang"];

export async function middleware(request: NextRequest) {
  if (dataSource() === "mock") return NextResponse.next();
  const cfg = supabasePublicConfig();
  if (!cfg) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    ...supabaseServerGlobal(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });

  // getUser() validates the token with the auth server and refreshes it when needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return copyCookies(response, NextResponse.redirect(url));
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return copyCookies(response, NextResponse.redirect(url));
  }
  return response;
}

function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const c of from.cookies.getAll()) to.cookies.set(c);
  return to;
}

export const config = {
  // Everything except API routes, Next internals and static files.
  matcher: ["/((?!api/|_next/static|_next/image|theme-packs/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|pdf|epub|txt|webmanifest|woff2?)$).*)"],
};
