# @kortex/mcp-server

Headless [MCP](https://modelcontextprotocol.io) server that exposes the Kortex second brain (Supabase schema `kortex`) to external AI agents: Claude Code, Claude Desktop, Cursor. Two transports, six tools, one user per server process.

```
agent ──stdio──────────────┐
agent ──HTTP + Bearer──────┤  tools (Zod) ──► BrainRepository ──► SupabaseBrainRepository ──► kortex.*
                           │                                  └─► InMemoryBrainRepository (tests / dry runs)
```

## Tools

| Tool | Arguments | What it does |
| --- | --- | --- |
| `brain_search` | `query`, `type?`, `folder_path?`, `tags?[]`, `limit?` (1-50, default 10) | Hybrid (vector + full-text, RRF) search; full-text only when no embedder is wired or the embedding call fails. `folder_path` includes sub-folders, `tags` must all match and match hierarchically (`ai` ~ `ai/mcp`). |
| `brain_get_item` | `id` (uuid or `"agents.md"`), `include_highlights?` | One item with full Markdown, metadata, tags; optionally its highlights. `id: "agents.md"` returns the agents guide (below). |
| `brain_save_item` | `title`, `content_md`, `type?` (default `note`), `folder_path?`, `source_url?` (http/https), `tags?[]` | Creates an item with status `inbox`. No `folder_path` ⇒ `00_Inbox` (or the type's home: objects ⇒ `70_Objects/<Type>`, `ai_chat` ⇒ `40_AI_Memories`, `daily_note` ⇒ `10_Notes/Daily`, `digest` ⇒ `90_Digests`) and the AI organizer may refile it. An explicit `folder_path` sets `is_manual_placement = true`. |
| `brain_organize` | `action`: `create_folder` \| `move_item` \| `add_tags` \| `turn_into_object`; `folder_path?`, `item_id?`, `tags?[]`, `object_type?`, `metadata?{}` | `create_folder` (+ missing ancestors, idempotent); `move_item` (creates the target folder, sets `is_manual_placement = true`); `add_tags` (merged, normalised; also feeds `kortex.tags.usage_count`); `turn_into_object` retypes an item to one of the 7 domain objects and files it under `70_Objects/<Type>` unless it is manually placed. `metadata` is validated strictly against the field set of `object_type` (see `src/objects.ts`, mirrors `@kortex/db` `domain.ts`); unknown or mistyped fields are rejected with the list of allowed fields. Repeated calls merge metadata. |
| `brain_log_agent_memory` | `agent_name`, `topic`, `summary_md`, `decisions?[]`, `next_steps?[]` | Creates an `ai_chat` item in `40_AI_Memories`, cluster `AI & Engineering`, slug `YYYY-MM-DD_topic-slug` (so md-sync writes `40_AI_Memories/YYYY-MM-DD_topic-slug.md`; a same-day duplicate gets `-2`). Tags `ai/agent-memory`, `agent/<name>`. |
| `brain_manage_tasks` | `action`: `list` \| `create` \| `complete`; `title?`, `task_id?`, `due_date?` (ISO 8601), `priority?` (`low\|medium\|high\|urgent`), `include_done?` | `kortex.action_items`. `list` returns open/in-progress tasks by due date (`include_done` adds finished ones). |

### Agents guide (`agents.md`)

One routing guide for agents: vault folders and what goes where, item types, domain objects with their `metadata` fields, the frontmatter of a vault file, every tool with an example call, conventions, and the user's **live folder index** (every folder with its item count, archived items excluded). Source: `src/agents-guide.ts` (built from the `@kortex/db` constants and `src/objects.ts`, so it cannot drift from the schema; tests compare its tool list with the registered tools).

- MCP resource `kortex://agents.md` (`text/markdown`) and `brain_get_item { "id": "agents.md" }` (for clients without resources). The server instructions and the descriptions of `brain_search`, `brain_get_item` and `brain_save_item` point agents there. If the folder index fails, the guide comes without it.
- The same guide is the repo-root `agents.md` (`pnpm agents:index`, plus a repository map for code agents) and `<vault>/agents.md`, which md-sync keeps current with the local folder index.

Invalid input and "not found" come back as MCP tool errors (`isError: true`) with a message the agent can act on. All results are JSON text.

## Transports and auth

**stdio** (default): the agent spawns the process; no network, no token. Anything that can spawn it already has your credentials.

**Streamable HTTP**: `node dist/cli.mjs --http` (or `MCP_TRANSPORT=http`), endpoint `POST http://127.0.0.1:3333/mcp`.

- Every request needs `Authorization: Bearer $MCP_BEARER_TOKEN`; compared in constant time (SHA-256 of both sides + `timingSafeEqual`). Missing/wrong ⇒ `401` + `WWW-Authenticate: Bearer`. The server refuses to start without a token of at least 16 characters. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- Binds to `127.0.0.1` by default (`MCP_HTTP_HOST` to change, e.g. for a container; if you do, put TLS in front, a Bearer token over plain HTTP is sniffable). Port `MCP_HTTP_PORT` (default `3333`).
- Stateless: a fresh MCP server per request, JSON responses, no sessions, no SSE stream. `GET`/`DELETE` ⇒ `405`. `GET /healthz` is unauthenticated and returns `{"ok":true}` (for PM2/uptime checks).
- Request bodies are capped at 4 MB.

**Remote (claude.ai custom connector)**: with `MCP_PUBLIC_URL` set, `--http` serves the same `/mcp` endpoint publicly behind OAuth 2.1 (protected-resource and authorization-server metadata, dynamic client registration, PKCE, rotating refresh tokens). Users sign in with their Kortex account on the server's own sign-in page; only allow-listed Supabase users get in, and every request runs as that user under RLS (no service role). Setup, security model, the Supabase OAuth-server evaluation and the exact deployment steps: [REMOTE.md](REMOTE.md). Without `MCP_PUBLIC_URL` nothing changes: stdio and the static-token HTTP mode on 127.0.0.1 work as described here.

## Data access and the auth trade-off

The server is single-user: `KORTEX_USER_ID` (your `auth.users` id) is baked into every query (`user_id = …`). There are two ways to authenticate against the shared Supabase; pick one by which variables you set.

| | `SUPABASE_JWT_SECRET` (+ anon key) — **preferred** | `SUPABASE_SERVICE_ROLE_KEY` |
| --- | --- | --- |
| How | The server mints a 10-minute HS256 JWT (`sub = KORTEX_USER_ID`, role `authenticated`) and the Supabase client sends it as the user | Service-role key, bypasses RLS |
| RLS | Applies: the database refuses anything outside your `user_id` even if the code had a bug | Does not apply; isolation relies solely on the explicit `user_id` filters in `SupabaseBrainRepository` |
| Hybrid search | Works (`kortex.match_knowledge_hybrid` scopes by `auth.uid()`) | Works (`kortex.match_knowledge_hybrid_for_user`, executable by the service role only, scoped by `KORTEX_USER_ID`) |
| Blast radius of the secret | The JWT secret can mint a token for *any* user and sign any role, i.e. it is as powerful as the service key | Full DB access |
| Needs | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `KORTEX_USER_ID` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KORTEX_USER_ID` |

Both secrets are equally sensitive, and the Supabase instance is shared with other production apps: keep them out of Claude's config JSON (use `node --env-file`, below) and never commit them. `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the root `.env` are accepted as fallbacks. A per-user refresh-token/login flow would be the least-privilege option, but it needs an interactive sign-in and is not implemented.

## AI: embeddings and the organizer (`@kortex/ai-core`)

`src/ai.ts` builds everything with ai-core's shared ADR-06 resolver `createUserModelRouter` (the same one the web app and md-sync use): the user's `ai_routing_config`, the model catalog (`kortex.ai_model_catalog`, paged) and the user's **embedding lock** (`kortex.user_settings.embedding_lock`). The lock is pinned on the first embedding by whichever process embeds first; after that every query vector is made with exactly that model, and the search only compares chunks of that model (`item_chunks.metadata.embedding_model`, RPC filter `filter_embedding_model`). Any ADR-06 key is enough to start: `ANTHROPIC_API_KEY` (alias `CLAUDE_API_KEY`), `OPENROUTER_API_KEY`, `EDENAI_API_KEY`; a routed provider without its key is reported by name at startup. OpenRouter requests always carry `provider.data_collection = 'deny'` (a test captures the request and checks it). `KORTEX_BACKEND=memory` uses the env-only router (defaults + offline fallback list).

| Piece | On when | What it does |
| --- | --- | --- |
| Embedder (`createAiCoreEmbedder`) | a key for the embeddings route's provider (default OpenRouter), not `KORTEX_MCP_EMBEDDINGS=0` | `brain_search` embeds the query with the user's pinned embedding model (1536 dims) and runs the hybrid RPC (both auth modes), filtered to chunks of that model. If the call fails the search degrades to full-text (`"mode": "fulltext"`). |
| Organizer (`createAiCoreEnricher`) | `KORTEX_MCP_ORGANIZE=1` + a key for the `auto_organize` route (default Anthropic) | After `brain_save_item` / `brain_log_agent_memory` create the item, the ai-core pipeline runs on it: `ai-chat` adapter (memories) or `text-note` → organizer → chunker → embeddings. Writes `summary`, tags (existing ∪ AI), `entities`, `status`, `metadata` (`ai_title`, takeaways, `ingest`), `item_chunks` with embeddings, and for items that are not manual placements also `cluster_name` + `folder_path`. Title, slug and the agent's Markdown are never changed. Agent memories always stay in `40_AI_Memories` with cluster `AI & Engineering`. No tasks are created (use `brain_manage_tasks`). The response gets an `enrichment` block (`ok`, `status`, `chunks`, `tags`, `folder_path`, `warnings`); if the organizer fails the item is still saved and `enrichment.ok` is false. The call waits for the models (a few seconds). With a Supabase backend the organizer has the same gates as `/api/ingest`: a switched-off connector (`enabled_connectors`, e.g. `ai_chat` for memories) or a used-up daily AI budget skips it (`enrichment.status: "skipped"` with a `reason`, no AI call); below `auto_place_threshold` the item stays in its folder and the target is only proposed (`enrichment.proposed_folder`, `metadata.placement.folder_path`). Every model call writes an `ai_usage` row (needs service-role mode; with a user JWT the row is refused by RLS and only logged). |

Startup notes on stderr say which mode is active, e.g. `routing: catalog 1786 models`, `search: hybrid (embeddings openrouter:qwen/qwen3-embedding-8b, locked)`, and warn about offline-fallback ids that dropped out of the catalog.

## Local services (md-sync + MCP)

Two single-user background processes on your PC, both configured from the repo root `.env` / `.env.local` (gitignored; template in `.env.example`):

| Service | Start | Talks to |
| --- | --- | --- |
| md-sync daemon | `pm2 start packages/md-sync/ecosystem.config.cjs` (or `pnpm --filter @kortex/md-sync start`) | Supabase (service role) + Realtime, `KORTEX_VAULT_PATH`, OpenRouter (ingest) |
| MCP server, HTTP on `127.0.0.1:3333` | `pnpm --filter @kortex/mcp-server build`, then `pm2 start "node --env-file=C:/dev/kortex/.env.local C:/dev/kortex/packages/mcp-server/dist/cli.mjs --http" --name kortex-mcp` | Supabase (user JWT or service role), OpenRouter (query embeddings, optional organizer) |

| Variable | md-sync | MCP server |
| --- | --- | --- |
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `KORTEX_USER_ID` | required | required |
| `SUPABASE_SERVICE_ROLE_KEY` | required | alternative to the JWT pair (hybrid search via the service-role RPC) |
| `SUPABASE_ANON_KEY` + `SUPABASE_JWT_SECRET` | – | preferred: RLS applies |
| `KORTEX_VAULT_PATH` | required | – |
| `ANTHROPIC_API_KEY` (alias `CLAUDE_API_KEY`), `OPENROUTER_API_KEY`, `EDENAI_API_KEY` (ADR-06; any one turns AI on, each routed task needs its provider's key) | ingest | query embeddings, organizer |
| `KORTEX_SYNC_INGEST`, `KORTEX_SYNC_INGEST_FOLDERS`, `KORTEX_SYNC_INGEST_DEBOUNCE_MS` | optional | – |
| `MCP_BEARER_TOKEN` (≥ 16 chars), `MCP_HTTP_PORT` (3333), `MCP_HTTP_HOST` | – | HTTP mode |
| `KORTEX_MCP_EMBEDDINGS=0`, `KORTEX_MCP_ORGANIZE=1` | – | optional |

Register the MCP server in Claude Code (HTTP service above):

```bash
claude mcp add --transport http --scope user kortex http://127.0.0.1:3333/mcp --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

or without the HTTP service (Claude Code spawns it over stdio):

```bash
claude mcp add --transport stdio --scope user kortex -- node --env-file=C:/dev/kortex/.env.local C:/dev/kortex/packages/mcp-server/dist/cli.mjs
```

How they meet: an agent calls `brain_log_agent_memory` → row in Supabase → Realtime → md-sync writes `40_AI_Memories/YYYY-MM-DD_topic.md`. Or the agent writes that file itself (playbook 5.3) → md-sync pushes and enriches it → `brain_search` finds it through its chunk embeddings. Each item is enriched once: md-sync only enriches local files, the MCP organizer only its own saves.

## Set up on this PC (exact commands)

Verified live on 2026-10-23 against the real account (all six tools over stdio in JWT mode and over HTTP in service-role mode; see "Live status" below). Run these yourself in PowerShell; the agent does not register servers or edit Claude config.

1. Build the bundle (again after every pull that touches `packages/mcp-server` or `packages/ai-core`):

   ```powershell
   cd C:\dev\kortex; pnpm --filter @kortex/mcp-server build
   ```

2. **Claude Code, stdio (recommended: no background process, Claude Code starts it on demand):**

   ```powershell
   claude mcp add --transport stdio --scope user kortex -- node --env-file=C:/dev/kortex/.env.local C:/dev/kortex/packages/mcp-server/dist/cli.mjs
   ```

3. **Claude Desktop:** put the `kortex` block from "Claude Desktop (stdio)" below into `%APPDATA%\Claude\claude_desktop_config.json` (merge into an existing `mcpServers` object), then quit Claude Desktop from the tray and start it again.

4. Optional **HTTP** (one shared server for several clients): start it as a service (see "Running it as a background service"), then register it without typing the token into the terminal history:

   ```powershell
   $t = (Select-String -Path C:\dev\kortex\.env.local -Pattern '^MCP_BEARER_TOKEN=(.*)$').Matches[0].Groups[1].Value.Trim('"'); claude mcp add --transport http --scope user kortex-http http://127.0.0.1:3333/mcp --header "Authorization: Bearer $t"; Remove-Variable t
   ```

5. Check: `claude mcp list` shows `kortex` as connected; in a session ask "search my brain for …" (`brain_search`). The server's stderr says `search: hybrid (embeddings …, locked)` once the embedding model is pinned.

With `SUPABASE_JWT_SECRET` in `.env.local` the server runs in JWT mode (RLS applies). Add `KORTEX_MCP_ORGANIZE=1` to `.env.local` if saves should be tagged/embedded right away (a few seconds and a fraction of a cent per save).

## Configure your agents

Build the single-file bundle once (and after every change), then point agents at it. Replace `C:/dev/kortex` with your checkout.

```bash
pnpm --filter @kortex/mcp-server build      # -> packages/mcp-server/dist/cli.mjs
```

Put the variables above in `C:/dev/kortex/.env.local` (see root `.env.example`; add `SUPABASE_JWT_SECRET` if you use the preferred mode) and let Node load them with `--env-file`, so no secret lands in an agent config. Dry run without any database: set `KORTEX_BACKEND=memory`.

### Claude Desktop (stdio)

`%APPDATA%\Claude\claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "kortex": {
      "command": "node",
      "args": [
        "--env-file=C:/dev/kortex/.env.local",
        "C:/dev/kortex/packages/mcp-server/dist/cli.mjs"
      ]
    }
  }
}
```

Variant with inline variables instead of `--env-file`:

```json
{
  "mcpServers": {
    "kortex": {
      "command": "node",
      "args": ["C:/dev/kortex/packages/mcp-server/dist/cli.mjs"],
      "env": {
        "SUPABASE_URL": "https://supabase.example.com",
        "SUPABASE_ANON_KEY": "<anon key>",
        "SUPABASE_JWT_SECRET": "<jwt secret>",
        "KORTEX_USER_ID": "<your auth.users uuid>"
      }
    }
  }
}
```

Claude Desktop only launches stdio servers from this file. To use the HTTP server from Claude Desktop, bridge it with `mcp-remote` (set `MCP_BEARER_TOKEN` in the `env` block):

```json
{
  "mcpServers": {
    "kortex-http": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://127.0.0.1:3333/mcp",
        "--header",
        "Authorization:${KORTEX_AUTH}"
      ],
      "env": { "KORTEX_AUTH": "Bearer <MCP_BEARER_TOKEN>" }
    }
  }
}
```

### Claude Code

stdio (user scope, available in every project):

```bash
claude mcp add --transport stdio --scope user kortex -- node --env-file=C:/dev/kortex/.env.local C:/dev/kortex/packages/mcp-server/dist/cli.mjs
```

HTTP (start the server first: `node --env-file=C:/dev/kortex/.env.local C:/dev/kortex/packages/mcp-server/dist/cli.mjs --http`):

```bash
claude mcp add --transport http --scope user kortex-http http://127.0.0.1:3333/mcp --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

Check with `claude mcp list`; remove with `claude mcp remove kortex`. For the automatic session archiving from the playbook (section 5.3), add to `~/.claude/CLAUDE.md`: *"At the end of every significant session (or on 'wrap up' / 'save memory') call the MCP tool `brain_log_agent_memory`."*

### Cursor

`~/.cursor/mcp.json` takes the same `mcpServers` block as Claude Desktop (stdio), or `{ "url": "http://127.0.0.1:3333/mcp", "headers": { "Authorization": "Bearer <token>" } }` for HTTP.

### Running it as a background service (PM2)

Only needed for HTTP; stdio clients start their own process.

```powershell
pm2 start "node --env-file=C:/dev/kortex/.env.local C:/dev/kortex/packages/mcp-server/dist/cli.mjs --http" --name kortex-mcp
pm2 save
```

Autostart at logon, logs, and a Task Scheduler alternative: see "Daily use on Windows" in `packages/md-sync/README.md`. Health check: `curl http://127.0.0.1:3333/healthz` → `{"ok":true}`.

## Live status (2026-10-23, WP-F)

Ran against the real account with `[KORTEX-TEST]` data, removed again afterwards (account back to its pre-test state):

- **stdio, JWT mode:** all six tools. `brain_search` ran hybrid with the locked embedding model and found an md-sync-ingested memory as its top hit; `brain_organize` created a folder, moved, tagged and retyped an item to `concept` (manual placement kept its folder); `brain_log_agent_memory` → md-sync wrote `40_AI_Memories/2026-10-23_….md` within a second; tasks create/list/complete.
- **HTTP 127.0.0.1:3333, service-role mode, `KORTEX_MCP_ORGANIZE=1`:** 401 without the token, `/healthz` ok, all six tools; hybrid search through `match_knowledge_hybrid_for_user`; the organizer (Anthropic Haiku via routing) enriched the saved note and the memory (summary, tags, one embedded chunk each).
- Not checked live: highlights (none existed), Claude Desktop/Code registration (left to the user).

## Development

```bash
pnpm --filter @kortex/mcp-server start        # stdio via tsx (no build)
pnpm --filter @kortex/mcp-server start:http   # HTTP via tsx
pnpm turbo run typecheck lint test --filter=@kortex/mcp-server
```

Tests use the MCP SDK client against `InMemoryBrainRepository`: tool listing, every tool incl. validation errors, per-type object metadata, the HTTP transport with and without/with a wrong Bearer token, and the real stdio entry point (spawned with `KORTEX_BACKEND=memory`). `test/ai-wiring.test.ts` covers the ai-core wiring with mocked models (hybrid search, organizer on both save tools, manual placement, failure handling) and a captured OpenRouter request carrying `data_collection: 'deny'`; the cross-package end-to-end test (vault file → md-sync → ai-core → `brain_search`) lives in `packages/md-sync/test/e2e-memory-search.test.ts`. `SupabaseBrainRepository` search (service-role mode, `match_knowledge_hybrid_for_user`) ran live once on 2026-10-23 (WP-A check with a temporary user: hybrid hits for a web-ingested note and an md-sync memory, both embedded with the pinned model); every other repository method ran live in the WP-F check (see "Live status").

## Files

`src/tools.ts` the six tools + the `kortex://agents.md` resource · `src/agents-guide.ts` the agents guide · `src/ai.ts` ai-core embedder + organizer, env wiring · `src/repository.ts` interface (+ `EnrichableRepository`) · `src/memory-repository.ts` (term + chunk-vector search fused by RRF) · `src/supabase-repository.ts` · `src/objects.ts` per-object metadata schemas · `src/http.ts` Streamable HTTP, routing, CORS, rate limits · `src/oauth/` OAuth 2.1 server (provider, config, jwt, sign-in pages, per-user context, logging/limits) · `src/server.ts` stdio + server factory · `src/config.ts` env → repository, JWT minting · `src/cli.ts` entry point.
