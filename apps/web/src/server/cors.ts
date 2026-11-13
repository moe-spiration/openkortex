// CORS for the browser extension. It authenticates with a bearer token and sends
// `credentials: "omit"`, so echoing an extension origin does not expose cookies.

const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[a-z0-9-]+$/i;

export function corsHeaders(request: Request, allowedOrigins: readonly string[]): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  if (origin && (EXTENSION_ORIGIN.test(origin) || allowedOrigins.includes(origin))) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("access-control-allow-headers", "authorization, content-type, x-kortex-locale");
    headers.set("access-control-max-age", "600");
    headers.set("vary", "origin");
  }
  return headers;
}

export const withHeaders = (response: Response, extra: Headers): Response => {
  extra.forEach((value, key) => {
    if (key === "set-cookie") response.headers.append(key, value);
    else response.headers.set(key, value);
  });
  return response;
};
