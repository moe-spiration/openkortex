# apps/web server (API routes)

Server-only modules behind `src/app/api/**`. Route files only wire `getServerDeps()`; all logic is here and is tested with an in-memory fake Supabase and mock models (`__tests__/`, no network).

## Auth (every route)

1. `Authorization: Bearer <KORTEX_API_TOKEN>`: personal token for the browser extension and scripts. Acts as `KORTEX_API_TOKEN_USER_ID` through the **service role**; every query filters `user_id` explicitly.
2. `Authorization: Bearer <Supabase access token>`: mobile, desktop or MCP with a user JWT (RLS applies).
3. Supabase auth cookie (web app session via `@supabase/ssr`; refreshed cookies are written back).

The first authenticated request per user and process calls `kortex.bootstrap_user()` (or `_bootstrap_user(uuid)` on the API-token path).

Errors always look like `{ ok: false, error: { code, message, details? } }`, with codes `not_configured` 503, `unauthorized` 401/403, `invalid_request` 400/413, `not_found` 404, `rate_limited` 429, `server_error` 500. Requests from `chrome-extension://` and `moz-extension://` origins get CORS headers.

## Endpoints

| Route | Body | Response |
| --- | --- | --- |
| `POST /api/ingest` | JSON `kind`: `web_clip`, `highlight`, `ai_chat` (exactly the extension contract) or `note`; or multipart `file` (+ `folder_path`, `tags`, `title`, `note`; PDF/EPUB/images, max 50 MB) | `IngestSuccess` (`item_id`, `status: "inbox"`, `folder_path`, `auto_routed`, `duplicate`, `queued`, `file?`, `highlight_id?`) |
| `GET /api/ingest[?item_id=]` | – | `{ ok, user_id, item? }`. Connection test, or status poll for one item |
| `POST /api/chat` | `{ messages, mode: note\|folder\|brain, item_id?, folder_path?, cluster?, model?, match_count? }` | AI SDK UI message stream (SSE, works with `useChat`). The first part is `data-citations` `{ mode, model, citations[] }`; the answer cites sources as `[n]` |
| `POST /api/chat/action` | `{ action: rewrite\|summarize\|outline\|flashcards\|tasks, item_id? \| content_md?, instruction?, model?, save?, count? }` | `{ ok, action, model, content_md \| flashcards \| action_items, saved }` |
| `GET /api/models[?provider=anthropic|openrouter|edenai][&task=<AiTask>][&refresh=1]` | – | `{ ok, providers: [{ provider, source: live|cache, fetched_at, warning?, models: ModelCatalogEntry[] }] }`. ADR-06 model picker; `task` keeps models that can serve it (embeddings: 1536 dims only) |
| `POST /api/digest` | `{ days?=7, cluster? \| folder_path?, model?, save?=true, max_groups? }` | `{ ok, period, digests[] }`. Saved as `type: "digest"` in `90_Digests`, one per cluster/folder and ISO week, updated on re-run |

## AI routing (ADR-06)

- Per-task routes live in `kortex.user_settings.ai_routing_config`; types, Zod schemas, defaults and helpers come from `@kortex/db` (`packages/db/src/routing.ts`).
- Settings UI: server actions `getAiRouting()` / `updateAiRouting(patch)` in `routing/actions.ts` (patch = any subset of tasks and fields; a provider switch without a model resets to Auto).
- `GET /api/models` (`routing/models.ts`) serves `kortex.ai_model_catalog`; when it is empty, older than 24 h or `refresh=1` it calls the `DiscoverModels` seam in `routing/discovery.ts` and upserts with the service role. Until ai-core implements discovery (part B) the cache is returned with a `warning`.

## Ingest flow

The request validates the body, dedupes by normalized URL (or chat URL), writes an optimistic `knowledge_items` row (`status: inbox`) and enqueues the job, then returns. The job (`ingest/process.ts`) sets `processing`, runs the `@kortex/ai-core` pipeline, uploads files through the Supabase `StorageGateway`, and replaces the row, `item_chunks` and the item's open `action_items`. It also bumps `tags.usage_count` and creates AI-suggested sub-folders. If the job fails, the item gets `status: error` with the reason in `metadata.ingest.error`.

The queue (`queue.ts`) is in-process: 2 jobs at a time, kept alive with Next `after()`. A restart loses queued jobs; their items stay `inbox`/`processing`. Use a durable queue once that matters.

## Env

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (only for the API-token path), `KORTEX_API_TOKEN`, `KORTEX_API_TOKEN_USER_ID` (defaults to `KORTEX_USER_ID`), `KORTEX_ALLOWED_ORIGINS` (optional, comma list), `ANTHROPIC_API_KEY` (alias `CLAUDE_API_KEY`), `OPENROUTER_API_KEY`, `EDENAI_API_KEY` (the three ADR-06 keys); optional direct overrides `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `JINA_API_KEY`, `FIRECRAWL_API_KEY`; `DEFAULT_*_MODEL` (deprecated by ADR-06 routing). Placeholder values like `<DEIN_...>` count as unset.
