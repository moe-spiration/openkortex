import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_SCOPE,
  SCOPES,
  isAllowedRedirectUri,
  redirectMatches,
  type OAuthConfig,
} from "./config";
import { audienceIncludes, signJwt, verifyJwt, type Claims } from "./jwt";
import { createRateLimiter, createUsedSet, silentLogger, type Logger } from "./ops";
import { PRODUCT_NAME, t } from "../i18n";
import { renderConsentPage, renderErrorPage } from "./pages";

// A small OAuth 2.1 authorization server embedded in the MCP server (RFC 6749 + PKCE S256, RFC 7591
// dynamic registration, RFC 8414 metadata, RFC 8707 resource binding, RFC 7009 revocation). Users
// sign in against Supabase Auth; this server never stores a password. Everything it issues is a
// signed JWT, so it needs no database: client ids, codes, access and refresh tokens.

export interface AuthInfo {
  kind: "oauth" | "supabase" | "static";
  userId: string;
  clientId?: string;
  scopes: string[];
}

/** A response the HTTP layer writes out; the provider itself never touches sockets. */
export interface Reply {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  html?: string;
  redirect?: string;
}

/** Supabase email/password sign-in. Null = wrong credentials; throws when Supabase is unreachable. */
export type PasswordLogin = (email: string, password: string) => Promise<{ userId: string } | null>;

export interface ProviderDeps {
  login: PasswordLogin;
  log?: Logger;
  nowMs?: () => number;
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;
const CLIENT_TTL_SECONDS = 180 * 86400;
const REQUEST_TTL_SECONDS = 600;

const oauthError = (status: number, error: string, description: string, headers: Record<string, string> = {}): Reply => ({
  status,
  headers: { ...NO_STORE, ...headers },
  json: { error, error_description: description },
});

const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Drops control characters and markup-ish noise from a client-supplied display name. */
export const cleanClientName = (v: unknown): string => {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim() : "";
  return s.slice(0, 100) || "Unbekannte Anwendung";
};

const sameResource = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export function createOAuthProvider(cfg: OAuthConfig, deps: ProviderDeps) {
  const log = deps.log ?? silentLogger;
  const nowMs = deps.nowMs ?? Date.now;
  const nowS = () => Math.floor(nowMs() / 1000);
  const usedJti = createUsedSet(nowMs);
  const revokedFamilies = new Map<string, number>(); // family -> expires (ms)
  const registerLimit = createRateLimiter({ limit: 20, windowMs: 3_600_000, now: nowMs });
  const tokenLimit = createRateLimiter({ limit: 60, windowMs: 60_000, now: nowMs });
  const loginIpLimit = createRateLimiter({ limit: 30, windowMs: 900_000, now: nowMs });
  const loginAccountLimit = createRateLimiter({ limit: 8, windowMs: 900_000, now: nowMs });

  const sign = (claims: Claims, typ: string) => signJwt(cfg.secret, { iss: cfg.issuer, ...claims }, { typ });
  const isRevoked = (fam: unknown) => typeof fam === "string" && (revokedFamilies.get(fam) ?? 0) > nowMs();
  const revokeFamily = (fam: string) => revokedFamilies.set(fam, nowMs() + cfg.refreshTtlSeconds * 1000);
  const allowed = (userId: string) => cfg.allowedUserIds.includes(userId);

  const tooMany = (retryAfter: number): Reply => ({
    status: 429,
    headers: { ...NO_STORE, "Retry-After": String(retryAfter) },
    json: { error: "slow_down", error_description: t("Too many requests. Please try again later.") },
  });

  // ---- metadata ---------------------------------------------------------------------------

  const protectedResourceMetadata = (): Reply => ({
    status: 200,
    headers: { "Cache-Control": "public, max-age=300" },
    json: {
      resource: cfg.resource,
      authorization_servers: [cfg.issuer],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: `${PRODUCT_NAME} Second Brain`,
    },
  });

  const authorizationServerMetadata = (): Reply => ({
    status: 200,
    headers: { "Cache-Control": "public, max-age=300" },
    json: {
      issuer: cfg.issuer,
      authorization_endpoint: `${cfg.issuer}/oauth/authorize`,
      token_endpoint: `${cfg.issuer}/oauth/token`,
      registration_endpoint: `${cfg.issuer}/oauth/register`,
      revocation_endpoint: `${cfg.issuer}/oauth/revoke`,
      scopes_supported: [...SCOPES],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    },
  });

  // ---- dynamic client registration (RFC 7591) ----------------------------------------------

  function register(body: unknown, ip: string): Reply {
    if (!registerLimit.take(ip)) return tooMany(registerLimit.retryAfter(ip));
    const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
    if (uris.length < 1 || uris.length > 5 || uris.some((u) => typeof u !== "string")) {
      return oauthError(400, "invalid_redirect_uri", t("redirect_uris: 1 to 5 URIs required"));
    }
    const bad = (uris as string[]).find((u) => !isAllowedRedirectUri(cfg, u));
    if (bad) {
      log.warn("register: redirect uri refused", { redirect_uri: bad });
      return oauthError(400, "invalid_redirect_uri", t("redirect_uri not allowed: {uri}", { uri: bad.slice(0, 200) }));
    }
    const method = b.token_endpoint_auth_method ?? "none";
    if (method !== "none") {
      return oauthError(400, "invalid_client_metadata", t("Only public clients (token_endpoint_auth_method=none) are supported"));
    }
    const grants = Array.isArray(b.grant_types) ? b.grant_types : ["authorization_code", "refresh_token"];
    if (grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
      return oauthError(400, "invalid_client_metadata", t("grant_types: only authorization_code and refresh_token"));
    }
    const name = cleanClientName(b.client_name);
    const issuedAt = nowS();
    const clientId = sign(
      { sub: "client", jti: randomUUID(), redirect_uris: uris, client_name: name, iat: issuedAt, exp: issuedAt + CLIENT_TTL_SECONDS },
      "client",
    );
    log.info("register: client", { client_name: name });
    return {
      status: 201,
      headers: NO_STORE,
      json: {
        client_id: clientId,
        client_id_issued_at: issuedAt,
        client_name: name,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: DEFAULT_SCOPE,
      },
    };
  }

  function readClient(clientId: string | null) {
    if (!clientId) return null;
    const v = verifyJwt(cfg.secret, clientId, { typ: "client", nowMs: nowMs() });
    if (!v.ok || v.claims.iss !== cfg.issuer) return null;
    const uris = v.claims.redirect_uris;
    if (!Array.isArray(uris) || uris.some((u) => typeof u !== "string")) return null;
    return { clientId, name: cleanClientName(v.claims.client_name), redirectUris: uris as string[] };
  }

  const scopeOf = (requested: string | null): string => {
    const asked = (requested ?? "").split(/\s+/).filter(Boolean);
    const granted = asked.filter((s) => (SCOPES as readonly string[]).includes(s));
    return granted.length ? [...new Set(granted)].join(" ") : DEFAULT_SCOPE;
  };

  const redirectWith = (base: string, params: Record<string, string | undefined>): Reply => {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
    u.searchParams.set("iss", cfg.issuer);
    return { status: 302, headers: NO_STORE, redirect: u.toString() };
  };

  // ---- authorization endpoint (consent + sign-in page) -------------------------------------

  function authorize(q: URLSearchParams): Reply {
    const client = readClient(q.get("client_id"));
    const redirectUri = q.get("redirect_uri");
    // Until client and redirect_uri are proven valid we must NOT redirect: show an error page.
    if (!client) return { status: 400, headers: NO_STORE, html: renderErrorPage(t("Unknown or expired client. Please add the connector again.")) };
    if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) {
      return { status: 400, headers: NO_STORE, html: renderErrorPage(t("The redirect address is not registered for this client.")) };
    }
    const state = q.get("state") ?? undefined;
    const fail = (error: string, description: string) =>
      redirectWith(redirectUri, { error, error_description: description, state });
    if (q.get("response_type") !== "code") return fail("unsupported_response_type", t("response_type=code required"));
    const challenge = q.get("code_challenge");
    if (!challenge || !PKCE_CHALLENGE.test(challenge) || q.get("code_challenge_method") !== "S256") {
      return fail("invalid_request", t("PKCE with code_challenge_method=S256 is required"));
    }
    const resource = q.get("resource");
    if (resource && !sameResource(resource, cfg.resource)) {
      return fail("invalid_target", t("resource must be {resource}", { resource: cfg.resource }));
    }
    const request = sign(
      {
        client_id: client.clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        scope: scopeOf(q.get("scope")),
        state,
        nonce: randomUUID(),
        exp: nowS() + REQUEST_TTL_SECONDS,
      },
      "authreq",
    );
    return { status: 200, headers: consentHeaders(redirectUri), html: renderConsentPage({ clientName: client.name, redirectUri, request }) };
  }

  /** CSP for the sign-in page; `form-action` lists the client's origin because browsers apply it to the redirect after the POST. */
  function consentHeaders(redirectUri: string): Record<string, string> {
    const origin = new URL(redirectUri).origin;
    return {
      ...NO_STORE,
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self' ${origin}`,
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    };
  }

  async function authorizeSubmit(form: URLSearchParams, ip: string): Promise<Reply> {
    const v = verifyJwt(cfg.secret, form.get("request") ?? "", { typ: "authreq", nowMs: nowMs() });
    if (!v.ok) {
      return { status: 400, headers: NO_STORE, html: renderErrorPage(t("The sign-in has expired. Please start again from the connector.")) };
    }
    const c = v.claims;
    const client = readClient(typeof c.client_id === "string" ? c.client_id : null);
    const redirectUri = typeof c.redirect_uri === "string" ? c.redirect_uri : "";
    if (!client || !redirectMatches(client.redirectUris, redirectUri)) {
      return { status: 400, headers: NO_STORE, html: renderErrorPage(t("Client or redirect address invalid.")) };
    }
    const state = typeof c.state === "string" ? c.state : undefined;
    if (form.get("decision") === "deny") {
      return redirectWith(redirectUri, { error: "access_denied", error_description: t("Denied by the user"), state });
    }

    const page = (status: number, error: string): Reply => ({
      status,
      headers: consentHeaders(redirectUri),
      html: renderConsentPage({ clientName: client.name, redirectUri, request: form.get("request") ?? "", error }),
    });

    const email = text(form.get("email")?.trim(), 254)?.toLowerCase();
    const password = text(form.get("password"), 256);
    if (!email || !password) return page(400, t("Please enter e-mail and password."));
    if (!loginIpLimit.take(ip) || !loginAccountLimit.take(`${ip}|${email}`)) {
      log.warn("login: rate limited", { ip });
      return { ...tooMany(Math.max(loginIpLimit.retryAfter(ip), loginAccountLimit.retryAfter(`${ip}|${email}`))), json: undefined, html: renderErrorPage(t("Too many sign-in attempts. Please try again in a few minutes.")) };
    }

    let who: { userId: string } | null;
    try {
      who = await deps.login(email, password);
    } catch (e) {
      log.error("login: Supabase Auth unreachable", { error: e instanceof Error ? e.message : String(e) });
      return page(503, t("Sign-in is not possible right now. Please try again later."));
    }
    if (!who) {
      log.warn("login: wrong credentials", { ip });
      return page(401, t("E-mail or password is wrong."));
    }
    if (!allowed(who.userId)) {
      // Valid Supabase account, but not one of the people this server belongs to (shared instance).
      log.warn("login: user not allowed", { user: who.userId.slice(0, 8) });
      return { status: 403, headers: NO_STORE, html: renderErrorPage(t("This account is not enabled for this server.")) };
    }

    const code = sign(
      {
        sub: who.userId,
        client_id: client.clientId,
        redirect_uri: redirectUri,
        code_challenge: c.code_challenge,
        scope: c.scope,
        resource: cfg.resource,
        jti: randomUUID(),
        exp: nowS() + cfg.codeTtlSeconds,
      },
      "code",
    );
    log.info("authorize: code issued", { user: who.userId.slice(0, 8), client_id: client.clientId.slice(0, 12) });
    return redirectWith(redirectUri, { code, state });
  }

  // ---- token endpoint ----------------------------------------------------------------------

  function issueTokens(userId: string, clientId: string, scope: string, family: string) {
    const iat = nowS();
    const jti = randomUUID();
    const access = sign(
      { sub: userId, aud: cfg.resource, client_id: clientId, scope, fam: family, jti, iat, exp: iat + cfg.accessTtlSeconds },
      "at+jwt",
    );
    const refresh = sign(
      { sub: userId, aud: cfg.resource, client_id: clientId, scope, fam: family, jti: randomUUID(), iat, exp: iat + cfg.refreshTtlSeconds },
      "rt",
    );
    return {
      status: 200,
      headers: NO_STORE,
      json: { access_token: access, token_type: "Bearer", expires_in: cfg.accessTtlSeconds, refresh_token: refresh, scope },
    } satisfies Reply;
  }

  function token(form: URLSearchParams, ip: string): Reply {
    if (!tokenLimit.take(ip)) return tooMany(tokenLimit.retryAfter(ip));
    const client = readClient(form.get("client_id"));
    if (!client) {
      // Claude re-registers when it sees invalid_client from the token endpoint.
      return oauthError(401, "invalid_client", t("Unknown or expired client"), { "WWW-Authenticate": 'Bearer error="invalid_client"' });
    }
    const resource = form.get("resource");
    if (resource && !sameResource(resource, cfg.resource)) {
      return oauthError(400, "invalid_target", t("resource must be {resource}", { resource: cfg.resource }));
    }

    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const v = verifyJwt(cfg.secret, form.get("code") ?? "", { typ: "code", nowMs: nowMs() });
      if (!v.ok || v.claims.iss !== cfg.issuer) return oauthError(400, "invalid_grant", t("Code invalid or expired"));
      const c = v.claims;
      if (c.client_id !== client.clientId) return oauthError(400, "invalid_grant", t("Code belongs to another client"));
      if (c.redirect_uri !== form.get("redirect_uri")) return oauthError(400, "invalid_grant", t("redirect_uri differs"));
      const verifier = form.get("code_verifier") ?? "";
      if (!PKCE_VERIFIER.test(verifier) || !safeEqual(s256(verifier), String(c.code_challenge))) {
        return oauthError(400, "invalid_grant", t("PKCE check failed"));
      }
      if (!usedJti.markUsed(String(c.jti), (c.exp as number) * 1000)) {
        return oauthError(400, "invalid_grant", t("Code was already used"));
      }
      const userId = String(c.sub);
      if (!allowed(userId)) return oauthError(400, "invalid_grant", t("Account not enabled"));
      log.info("token: authorization_code", { user: userId.slice(0, 8), client_id: client.clientId.slice(0, 12) });
      return issueTokens(userId, client.clientId, String(c.scope), randomUUID());
    }

    if (grant === "refresh_token") {
      const v = verifyJwt(cfg.secret, form.get("refresh_token") ?? "", { typ: "rt", nowMs: nowMs() });
      if (!v.ok || v.claims.iss !== cfg.issuer) return oauthError(400, "invalid_grant", t("Refresh token invalid or expired"));
      const c = v.claims;
      if (c.client_id !== client.clientId) return oauthError(400, "invalid_grant", t("Refresh token belongs to another client"));
      const family = String(c.fam);
      if (isRevoked(family)) return oauthError(400, "invalid_grant", t("Refresh token revoked"));
      // Rotation: every refresh token works once; a replay means it leaked, so the whole family dies.
      if (!usedJti.markUsed(String(c.jti), (c.exp as number) * 1000)) {
        revokeFamily(family);
        log.warn("token: refresh token reuse, family revoked", { client_id: client.clientId.slice(0, 12) });
        return oauthError(400, "invalid_grant", t("Refresh token was already used"));
      }
      const userId = String(c.sub);
      if (!allowed(userId)) return oauthError(400, "invalid_grant", t("Account not enabled"));
      return issueTokens(userId, client.clientId, String(c.scope), family);
    }

    return oauthError(400, "unsupported_grant_type", t("authorization_code or refresh_token required"));
  }

  /** RFC 7009: always 200; a valid refresh/access token revokes its whole grant family. */
  function revoke(form: URLSearchParams): Reply {
    const raw = form.get("token") ?? "";
    for (const typ of ["rt", "at+jwt"]) {
      const v = verifyJwt(cfg.secret, raw, { typ, nowMs: nowMs() });
      if (v.ok && typeof v.claims.fam === "string") revokeFamily(v.claims.fam);
    }
    return { status: 200, headers: NO_STORE, json: {} };
  }

  // ---- resource side -----------------------------------------------------------------------

  /** Validates an access token this server issued: signature, expiry, issuer, audience, family, user. */
  function verifyAccessToken(raw: string): AuthInfo | null {
    const v = verifyJwt(cfg.secret, raw, { typ: "at+jwt", nowMs: nowMs() });
    if (!v.ok) return null;
    const c = v.claims;
    if (c.iss !== cfg.issuer || !audienceIncludes(c.aud, cfg.resource)) return null;
    if (isRevoked(c.fam) || typeof c.sub !== "string" || !allowed(c.sub)) return null;
    return {
      kind: "oauth",
      userId: c.sub,
      clientId: typeof c.client_id === "string" ? c.client_id : undefined,
      scopes: String(c.scope ?? "").split(" ").filter(Boolean),
    };
  }

  return {
    protectedResourceMetadata,
    authorizationServerMetadata,
    register,
    authorize,
    authorizeSubmit,
    token,
    revoke,
    verifyAccessToken,
  };
}

export type OAuthProvider = ReturnType<typeof createOAuthProvider>;
