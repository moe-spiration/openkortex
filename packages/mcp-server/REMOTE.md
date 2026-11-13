# Remote MCP server (claude.ai custom connector)

Remote mode lets claude.ai (web, desktop, mobile) and Claude Code use the Kortex brain through a public URL, with a per-user OAuth 2.1 sign-in instead of a shared static token. Local stdio and the static-token HTTP mode (127.0.0.1) are unchanged.

```
claude.ai ──401 + resource_metadata──► /mcp                     (protected resource)
          ──/.well-known/oauth-protected-resource ► {resource, authorization_servers:[issuer]}
          ──/.well-known/oauth-authorization-server ► endpoints, S256, registration
          ──POST /oauth/register (DCR) ► client_id (signed, stateless)
          ──browser► /oauth/authorize ► sign-in page ──► Supabase Auth (password grant) ► code
          ──POST /oauth/token (code + PKCE + resource) ► access token (1 h) + refresh token (30 d, rotating)
          ──POST /mcp  Authorization: Bearer <access token> ► tools, as that user, under RLS
```

## What claude.ai requires (checked 2026-10-23, claude.com/docs/connectors/building/authentication)

- Transport: Streamable HTTP (this server: stateless `POST /mcp`, JSON responses).
- A `401` with `WWW-Authenticate: Bearer resource_metadata="…"` starts sign-in; Claude ignores that header on a `200`.
- Protected-resource metadata (RFC 9728): `resource` must equal the URL users enter in Claude (`https://<domain>/mcp`); Claude uses only the first entry of `authorization_servers`.
- Authorization-server metadata (RFC 8414) reachable from Anthropic's egress range `160.79.104.0/21`; must advertise `code_challenge_methods_supported: ["S256"]` (PKCE S256 on every request).
- Client registration: Dynamic Client Registration (RFC 7591) or a Client ID Metadata Document (needs `client_id_metadata_document_supported` and `none` in `token_endpoint_auth_methods_supported`). This server offers DCR.
- Redirect URI of the hosted apps: exactly `https://claude.ai/api/mcp/auth_callback` (`https://claude.com/api/mcp/auth_callback` is announced as the future one; both are allowed). Claude Code uses a loopback redirect on a changing port.
- Token endpoint: form-encoded bodies, RFC 6749 errors (`invalid_grant` for a dead refresh token, `invalid_client` makes Claude re-register), refresh-token rotation for public clients, answers within 10 s (30 s for refresh).
- `resource` (RFC 8707) is sent in authorization and token requests; the server must only accept tokens issued for itself.

## Decision: embedded authorization server, login delegated to Supabase Auth

**Why not the Supabase OAuth 2.1 server?** Probed read-only against the live GoTrue (`v2.186.0`, https://supabase.example.com):

| Probe | Result |
| --- | --- |
| `GET /.well-known/oauth-authorization-server/auth/v1` | 404 from Kong (no route) |
| `GET /auth/v1/.well-known/oauth-authorization-server` (with apikey) | 404 from GoTrue: the OAuth server is **not enabled** (`GOTRUE_OAUTH_SERVER_ENABLED` unset) |
| `GET /auth/v1/.well-known/openid-configuration` (with apikey) | 200 but `issuer: ""` and relative endpoint paths: external URL/issuer not configured |
| `GET /auth/v1/.well-known/jwks.json` | `{"keys":[]}`: symmetric (HS256) signing only, so no asymmetric keys for `openid` and no audience-bound tokens |
| `POST /auth/v1/oauth/clients/register` (with apikey) | 404 (registration routes absent while disabled) |
| any `/auth/v1/*` without apikey | 401 from Kong: claude.ai sends no apikey, so every OAuth endpoint would need a Kong exception |

Using it would mean changing the **shared** Auth service: enabling the feature (`GOTRUE_OAUTH_SERVER_ENABLED=true`, `GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION=true`, `GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent`), fixing the external URL/issuer, adding Kong routes that skip `key-auth` for `/auth/v1/oauth/*` and the root-level `.well-known` path, building a consent page in the web app, restarting the auth container (a few seconds of login downtime for every app on the instance), and accepting that tokens carry `aud=authenticated` (no resource binding) while public sign-up with auto-confirm lets any user of the other apps obtain one. It is also a beta feature.

**What this server does instead** (no infrastructure change at all): a small OAuth 2.1 authorization server inside the MCP server (`src/oauth/`). The user signs in on its consent page with their Kortex e-mail and password; the server checks them with Supabase Auth (`POST /auth/v1/token?grant_type=password`, anon key) and throws the Supabase session away, then issues its own signed tokens. Everything is a signed JWT, so there is no database and nothing to migrate.

If Supabase's OAuth server becomes usable later, the resource side already accepts Supabase user JWTs (`MCP_ACCEPT_SUPABASE_TOKENS=1`); only `authorization_servers` in the metadata would change.

## Security model

- **Only allow-listed users.** The Supabase instance is shared with other apps. `MCP_OAUTH_ALLOWED_USER_IDS` (default `KORTEX_USER_ID`) is checked at sign-in, at every token exchange and refresh, and on every request. A valid account of another app gets a 403 page.
- **Audience-bound tokens.** Access tokens are `typ: at+jwt`, HS256 with `MCP_OAUTH_SECRET`, `iss` = public URL, `aud` = `https://<domain>/mcp`, `sub` = Supabase user id, 1 h. `/mcp` verifies signature, expiry, issuer, audience, grant family and user, and never forwards the token anywhere.
- **PKCE S256 only**, exact redirect-URI matching (loopback ports ignored per RFC 8252), codes live 120 s and work once, requests to the sign-in page are signed and expire after 10 minutes.
- **Registration is restricted**: DCR only accepts the Claude callbacks, loopback addresses and `MCP_OAUTH_REDIRECT_URIS`; confidential clients are refused. Client ids are signed JWTs (180 days), so nothing is stored; an expired id makes the token endpoint answer `invalid_client` and Claude re-registers.
- **Refresh tokens rotate**; presenting an old one revokes the whole grant family (and its access tokens). Revocation endpoint `POST /oauth/revoke` (RFC 7009). The used-token and revoked-family sets live in memory: a restart forgets them (live tokens keep working until they expire; reuse detection restarts from zero). Rotating `MCP_OAUTH_SECRET` revokes every grant.
- **No service role for user data.** Each request builds a Supabase client that acts as the token's user with a short-lived minted JWT (needs `SUPABASE_JWT_SECRET`), so RLS applies; remote mode refuses to start the per-user client without it. Note that the JWT secret is itself powerful: keep it in Coolify's secret store only.
- **Browser exposure.** Sign-in page: no scripts, no cookies, `frame-ancestors 'none'`, `form-action` limited to the client's origin, `no-store`, client names stripped of markup. `/mcp` checks `Origin` (DNS-rebinding protection) against `MCP_CORS_ORIGINS` (default claude.ai, claude.com, local Inspector); metadata and token endpoints answer CORS for any origin because they carry no cookies.
- **Abuse limits** (per process, in memory): sign-in 8 attempts per 15 min per IP+account and 30 per IP, registration 20/h per IP, token endpoint 60/min per IP, `/mcp` 600/min per IP before and 240/min per user after authentication. Request bodies: 4 MB for `/mcp`, 64 KB for OAuth. Slow clients are cut (15 s headers, 60 s request).
- **Logs** are one JSON object per line on stderr (`ts`, `level`, `msg`, `reqId`, `method`, `path`, `status`, `ms`, `ip`, `user` = first 8 chars of the id, `client_id` prefix). Keys that look like credentials are replaced with `[redacted]`, query strings and bodies are never logged (a test asserts that passwords, codes, verifiers and tokens do not appear). `/healthz` is not logged.

## Configuration (environment only)

| Variable | Required | Meaning |
| --- | --- | --- |
| `MCP_PUBLIC_URL` | yes | Public origin, `https://mcp.example.com`, no path (discovery lives at `/.well-known`). Turns remote mode on. |
| `MCP_OAUTH_SECRET` | yes | 32+ characters, signs everything. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `KORTEX_USER_ID` / `MCP_OAUTH_ALLOWED_USER_IDS` | one of them | Who may sign in (comma list of Supabase user ids). |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | yes | Sign-in against Supabase Auth. (`NEXT_PUBLIC_*` names work too.) |
| `SUPABASE_JWT_SECRET` | yes | Per-user RLS clients. |
| `MCP_TRUST_PROXY` | behind a proxy | `true` on Coolify/Traefik: client IP from the last `X-Forwarded-For` entry (needed for the rate limits). Leave off when the container port is exposed directly. |
| `MCP_BEARER_TOKEN` | no | Keep **unset** on the public server; set, it additionally accepts that static token as `KORTEX_USER_ID`. |
| `MCP_ACCEPT_SUPABASE_TOKENS` | no | `1`: also accept Supabase user access tokens (HS256, allow-listed users) as bearer tokens. |
| `MCP_OAUTH_REDIRECT_URIS`, `MCP_CORS_ORIGINS` | no | Extra redirect URIs / browser origins. |
| `MCP_OAUTH_ACCESS_TTL_SECONDS`, `MCP_OAUTH_REFRESH_TTL_SECONDS` | no | Defaults 3600 / 2592000. |
| `MCP_HTTP_HOST`, `MCP_HTTP_PORT` | no | Container default `0.0.0.0:3333`. |
| `OPENROUTER_API_KEY` etc. | no | Same AI keys as in local mode (hybrid search, organizer). |

Endpoints: `/mcp`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register|authorize|token|revoke`, `/healthz` (liveness), `/readyz` (Supabase Auth reachable).

## Try it locally (no public URL)

```bash
MCP_PUBLIC_URL=http://localhost:3333 MCP_OAUTH_SECRET=<48 chars> KORTEX_USER_ID=<uuid> \
SUPABASE_URL=https://supabase.example.com SUPABASE_ANON_KEY=<anon> SUPABASE_JWT_SECRET=<secret> \
node packages/mcp-server/dist/cli.mjs --http      # after: pnpm --filter @kortex/mcp-server build
npx @modelcontextprotocol/inspector                # Streamable HTTP, URL http://localhost:3333/mcp, "Open Auth Settings"
```

The Inspector registers itself (loopback redirect), opens the sign-in page, and then lists the six tools. Claude Code: `claude mcp add --transport http kortex-remote http://localhost:3333/mcp` and `/mcp` to sign in. claude.ai needs the public HTTPS deployment below (it cannot reach localhost). The automated test (`test/oauth-flow.test.ts`) runs the same flow with the SDK client against a mocked Supabase Auth.

## Deployment (needs the user: nothing here was done)

Not done by any agent: it creates a public service on the shared Coolify and a DNS record.

1. **DNS:** an A record `mcp.<your domain>` → the Coolify server IP.
2. **Source:** the repo has no git remote. Either push it to a private remote and let Coolify build `packages/mcp-server/Dockerfile` (Base Directory `/`), or build locally (`docker build -f packages/mcp-server/Dockerfile -t <registry>/kortex-mcp .`), push to a registry and create the app from that image.
3. **Coolify application** (new, does not touch the other apps or Supabase): port `3333`, domain `https://mcp.<your domain>` (Traefik issues the certificate), health check `GET /healthz`, environment from the table above (secrets as Coolify secrets): `MCP_PUBLIC_URL`, `MCP_OAUTH_SECRET`, `KORTEX_USER_ID`, `SUPABASE_URL=https://supabase.example.com`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `MCP_TRUST_PROXY=true`, optionally the AI keys. Do **not** set `MCP_BEARER_TOKEN` or `SUPABASE_SERVICE_ROLE_KEY`.
4. **Firewall/WAF:** allow `160.79.104.0/21` (Anthropic) to reach the domain.
5. **Check:** `curl -i https://mcp.<domain>/mcp -X POST -d '{}'` answers 401 with `resource_metadata`; `https://mcp.<domain>/.well-known/oauth-authorization-server` returns the metadata; `/readyz` is 200.
6. **claude.ai:** Settings → Connectors → Add custom connector → URL `https://mcp.<domain>/mcp`, leave client id/secret empty → Connect → sign in on the Kortex page with e-mail and password → Allow. On Team/Enterprise plans an Owner adds the connector, and each member then connects with their own sign-in (they must be on the allow-list).
7. Supabase Auth, Kong and the web app need **no change**.

Expected downtime: none for any existing service.

## Known limits and risks

- The sign-in page takes the Kortex password on the MCP domain. That domain must be yours and trusted; accounts that only use magic links need a password first (set it in Supabase). No MFA step yet (GoTrue MFA is not wired).
- State is in memory (used codes, rotated refresh tokens, revoked families, rate limits): single instance only, and a restart weakens replay/reuse detection until tokens expire. A second replica would need a shared store.
- Revocation per user/client other than rotating `MCP_OAUTH_SECRET` (revokes all) or `POST /oauth/revoke` with the user's refresh token does not exist yet.
- Allowed users are fixed by env, there is no admin UI.
- Not verified in this environment: the Docker build (no Docker available here), a real claude.ai connection (needs the public URL), a successful live sign-in (the tests use a mocked Supabase Auth; a read-only probe with a fake account confirmed that the live `POST /auth/v1/token?grant_type=password` with the anon key answers `400 invalid_credentials`, which the server maps to "wrong e-mail or password").
- CIMD is not offered (Claude then uses DCR). With heavy traffic each connection registers a new stateless client, which costs nothing to store.
