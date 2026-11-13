# @kortex/md-sync

Local 2-way Markdown sync daemon: Supabase (`kortex.knowledge_items` + `kortex.folders`) ⇄ `KORTEX_VAULT_PATH` (`~/KortexVault`). Spec: `02_Systemarchitektur` §3 + §7.1, Playbook Etappe 4.1.

```bash
pnpm --filter @kortex/md-sync start                # daemon (tsx src/cli.ts)
pnpm --filter @kortex/md-sync test                 # vitest, temp vaults + InMemoryRemoteStore
pnpm --filter @kortex/md-sync bundle               # one-file build dist/md-sync.mjs (desktop sidecar)
pm2 start packages/md-sync/ecosystem.config.cjs   # as a background service
```

## Two ways to run it

- **Desktop sidecar (default for users, since 0.6.0).** The Windows app starts md-sync itself
  (`apps/desktop/src-tauri/src/vault.rs`) with the folder from its settings and the personal `kx_`
  token from "Mit Windows-App verbinden" (scope `sync`). **Token mode:** the daemon trades the token
  at `POST /api/sync/session` for a one-hour user JWT and runs everything under RLS as that user
  (Realtime included); the Dropzone uploads through `POST /api/ingest`. No service-role key, no AI
  keys on the PC (AI enrichment of vault files stays off; the server enriches what comes through
  `/api/ingest`). Status goes to stdout as `@@kortex-status {json}` lines (`src/status-line.ts`).
- **CLI / server (service mode).** `pnpm --filter @kortex/md-sync start` with the service-role key,
  as before, e.g. on a server or for development. Never put the service-role key on a user's PC.

Only one daemon may run per vault: `<vault>/.kortex/daemon.lock` (`src/vault-lock.ts`) refuses a
second one (exit 5) and is taken over when its process is gone (or, from another host, after 3 min
without a refresh).

Exit codes: 0 stopped, 1 crash (the desktop restarts it with backoff), 2 configuration, 3 token
refused or revoked, 4 server without vault sync (web app older than 0.6.0 or no
`SUPABASE_JWT_SECRET`), 5 vault locked by another md-sync.

## Environment

Read from the process env, then `packages/md-sync/.env(.local)`, then the repo root `.env.local` / `.env` (real env vars win; service mode only).

**Token mode** (set `KORTEX_SYNC_TOKEN`; the service-mode variables below are then ignored):

| Var | Required | Notes |
| --- | --- | --- |
| `KORTEX_VAULT_PATH` | yes | as below |
| `KORTEX_SYNC_TOKEN` | yes | Personal `kx_` token with the scope `sync` (created by "Mit Windows-App verbinden"). |
| `KORTEX_API_URL` | yes | Web app, `https://…` (or `http://localhost`). |
| `KORTEX_SYNC_STATUS_STDOUT` | no | `1` prints the `@@kortex-status` / `@@kortex-fatal` lines. |
| `KORTEX_SYNC_STOP_ON_STDIN_END` | no | `1`: "stop" on stdin or stdin closed = clean stop; "sync" = full reconcile now. |
| `KORTEX_SYNC_VERSION` | no | Version shown in the heartbeat (the bundle has no package.json next to it). |

**Service mode:**

| Var | Required | Notes |
| --- | --- | --- |
| `KORTEX_VAULT_PATH` | yes | Created (with the default tree) if missing. `~` is expanded. |
| `KORTEX_USER_ID` | yes | Supabase auth user uuid. The daemon syncs exactly this user. |
| `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://supabase.example.com` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Headless daemon = no user session. Bypasses RLS, so every query is scoped to `KORTEX_USER_ID` in code. |
| `KORTEX_SYNC_DELETE_MODE` | no | `archive` (default: local delete → `status='archived'`) or `delete` (hard delete). |
| `KORTEX_SYNC_RECONCILE_MINUTES` | no | Safety-net full reconcile interval, default 10, `0` = off. |
| `KORTEX_SYNC_ALLOW_MASS_DELETE` | no | `1` lifts the >50-deletions-at-once guard. |
| `KORTEX_SYNC_USE_POLLING` | no | `1` for network drives / WSL paths where native watching is unreliable. |
| `KORTEX_SYNC_LOG_LEVEL` | no | `debug` / `info` (default) / `warn` / `error`. |
| `ANTHROPIC_API_KEY` (alias `CLAUDE_API_KEY`), `OPENROUTER_API_KEY`, `EDENAI_API_KEY` | for ingest | ADR-06 keys. Any one turns on AI enrichment of vault files (below); each routed task needs its provider's key (defaults: text → Anthropic, embeddings → OpenRouter). Without any key the daemon only syncs. |
| `KORTEX_SYNC_INGEST` | no | `0` turns enrichment off even with a key. |
| `KORTEX_SYNC_INGEST_FOLDERS` | no | Comma list, default `40_AI_Memories`. Add the inbox with `40_AI_Memories,00_Inbox`. |
| `KORTEX_SYNC_INGEST_DEBOUNCE_MS` | no | Quiet time after the last save before enriching, default `3000`. |
| `KORTEX_SYNC_HEARTBEAT` | no | `0` turns the heartbeat to `kortex.sync_status` off (below); then the web settings show no "Letzter Sync" and their Sync button has no daemon to reach. |
| `KORTEX_DEVICE_ID` | no | Stable id of this daemon in `kortex.sync_status`. Default: host name + 8-char hash of the vault path (one row per PC and vault). Set it if the host name changes. |
| `KORTEX_DEVICE_NAME` | no | Label the web settings show for this device. Default: the host name. |
| `KORTEX_SYNC_AGENTS_FILE` | no | `0` stops writing `<vault>/agents.md` (below). |

## Modules

| File | Role |
| --- | --- |
| `src/engine.ts` | `SyncEngine`: the state machine (below), serial job queue, events (`pulled`, `pushed`, `conflict`, `ai-memory`, `sync-error`, ...). |
| `src/frontmatter.ts` | `gray-matter` parse/render, row ⇄ canonical doc ⇄ file mapping, normalisation, `checksumOf`. |
| `src/checksum.ts` | `sha256:` over stable-stringified frontmatter fields + trimmed body. |
| `src/remote/store.ts` | `RemoteStore` interface (user-scoped). |
| `src/remote/supabase.ts` | `SupabaseRemoteStore` (`@kortex/db` client, schema `kortex`, Realtime with reconnect backoff). |
| `src/remote/memory.ts` | `InMemoryRemoteStore` (DB defaults, `updated_at` trigger, cascade, async change feed + test helpers). |
| `src/watcher.ts` | chokidar 5 on the vault (`**/*.md` + dirs, `awaitWriteFinish {400, 100}`). |
| `src/state.ts` | `.kortex/state.json`: last synced `{path, hash, remoteUpdatedAt}` per item + folder ids. |
| `src/echo-lock.ts` | Short per-path locks for the daemon's own writes/removals. |
| `src/fs-utils.ts` | Atomic write (`.tmp` + `rename` with Windows retry), trash, vault scan. |
| `src/paths.ts` | Windows-safe names, ignore rules, path helpers. |
| `src/vault-layout.ts` | Default tree bootstrap, folder → type inference. |
| `src/ingest.ts` | `VaultIngestor`: vault files → `@kortex/ai-core` pipeline → enrichment, chunks, tasks, tags. |
| `src/ai-routing.ts` | `createVaultPipeline`: live ADR-06 router (routing + catalog + embedding lock, rebuilt on change) → ai-core pipeline. |
| `src/agents-file.ts` | `VaultAgentsFile`: keeps `<vault>/agents.md` (agents guide + folder index) current. |
| `src/heartbeat.ts` | `SyncHeartbeat`: daemon status to `kortex.sync_status`, sync requests from the web settings. |
| `src/reembed-cli.ts` | `pnpm --filter @kortex/md-sync reembed`: explicit embedding-model switch (dry run by default). |
| `src/remote/enrichment-store.ts` | `EnrichmentStore` port (context, compare-and-set enrichment, chunks, tasks, tag usage); both stores implement it. |
| `src/config.ts`, `src/cli.ts` | Env loading and the daemon entry point. |

## Frontmatter ⇄ columns

`id`, `title`, `type`, `source_platform`, `folder_path`, `parent_item_id`, `icon`, `tags`, `entities`, `status`, `created_at`, `updated_at`, `metadata` map 1:1. Renamed: `source_ref` ⇄ `source_url`, `cover_image` ⇄ `cover_image_url`, `cluster` ⇄ `cluster_name`, `checksum` ⇄ `local_file_hash`. Body ⇄ `content_md` (trimmed, LF). Missing values normalise to the column defaults (`icon: file-text`, `cluster: General`, `status: inbox`, `source_platform: manual`, `[]`, `{}`) on both sides, so a fresh row and its file hash identically.

The checksum covers all frontmatter fields **except** `updated_at` and `checksum` (they change on every save). The file's **location** is the truth for `folder_path` and the slug; the `folder_path` key is rewritten after moves.

## State machine

Every item is compared three ways: local file **L**, remote row **R**, and the **base** = last agreed version (`state.json`, falling back to the file's own `checksum` if the state is lost).

| L vs base | R vs base | Action |
| --- | --- | --- |
| same | same | nothing (fast path, no row fetch) |
| changed | same | push (`upsert`, `local_file_hash` = checksum) |
| same | changed | pull (atomic write; rename/move the file if slug/folder changed) |
| changed | changed | conflict: newer wins (local time = file mtime, remote = `updated_at`), loser → `<slug>.conflict-<YYYYMMDDTHHmmssZ>.md` next to it (local only, never synced) |
| same | deleted/archived | local file → `.kortex/trash/` |
| changed | deleted/archived | push (local edits revive it) |
| deleted | same | archive remote (or delete, see env) |
| deleted | changed | pull (remote edit recreates the file) |

Loop prevention: equal checksums never trigger a write; the daemon's own writes are echo-locked by path **and** content hash (a real edit inside the lock window still syncs); Realtime echoes of our own pushes are recognised by `updated_at == state.remoteUpdatedAt`.

Triggers: chokidar events (deletes wait 2.5 s so a move = unlink + add is detected by id), Realtime `postgres_changes` (ids only; rows are re-fetched because payloads can omit TOASTed `content_md`), and a full reconcile on start, on every Realtime reconnect, and every 10 min.

Realtime outages: on `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` the channel is recreated with exponential backoff (1 s → 60 s). The backoff only starts over after a connection stayed up for 30 s, and the daemon ignores status events of channels it removes itself (before that fix, one drop caused a reconnect + full reconcile every ~0.5 s; found live). Changes made during the outage arrive through the reconcile after the reconnect.

## Rules worth knowing

- **New local files** get an id (written back into the frontmatter once). Type is inferred from the folder (`70_Objects/People` → `person`, `10_Notes/Daily` → `daily_note`, `40_AI_Memories` → `ai_chat`, `50_Recipes`, `20_Meetings`, `90_Digests`; else `note`).
- **Manual placement**: new files outside `00_Inbox` and every local move set `is_manual_placement = true`; content edits leave it alone. New sub-folders create `folders` rows (with `parent_id`) for every level.
- **Copies** (same id in two files) become a new item. A foreign id (row of another user) gets a fresh id.
- **Root files** (`<vault>/x.md`) are moved into `00_Inbox/`.
- **Archived items are not materialised** in the vault.
- **Broken YAML**: the file is skipped and never overwritten; fix it and it syncs.
- **Safety**: daemon removals go to `.kortex/trash/`, never unlink user content; deletes are not propagated if the vault folder disappears; more than 50 deletions at once are held back.
- **Folders it can't touch** (EPERM: on Windows a folder deleted while a watcher or editor still holds it stays "delete pending"): the reconcile reports `folder not accessible, skipped` for that folder and syncs the rest. Notes tracked inside it count as unknown, not deleted, and a deletion that can't be confirmed is not propagated. Only an unreadable vault root stops the reconcile.
- **`40_AI_Memories/`**: a new file emits `ai-memory` / calls `onAiMemory` once it is in Supabase; enrichment is done by the ingestor below.
- Ignored: dot-folders (`.kortex`, `.obsidian`, `.git`, `.trash`), `*.tmp`, `*.conflict-*.md`, non-`.md` files, and the root `agents.md` (written by the daemon, below).

## AI enrichment (ingest)

Files the user or an agent writes into `KORTEX_SYNC_INGEST_FOLDERS` (default `40_AI_Memories/`) run through the same `@kortex/ai-core` pipeline as `/api/ingest`: `ai-chat` adapter (agent memories, ChatGPT/Claude exports; `text-note` for plain notes) → organizer → chunker → embeddings.

**Models (ADR-06, `src/ai-routing.ts`).** The daemon builds its router with ai-core's shared resolver, exactly like the web app and the MCP server: the user's `ai_routing_config`, the model catalog (`kortex.ai_model_catalog`, paged past PostgREST's 1,000-row limit) and the user's embedding lock. The startup line `ai routing` lists the resolved summarize / auto_organize / embeddings routes. OpenRouter requests always carry `provider.data_collection = 'deny'`.

**Routing changes apply without a restart.** The router is `createLiveUserModelRouter`: a Realtime feed on the user's own `kortex.user_settings` row (routing, embedding lock) and a catalog refresh every 6 h mark it stale, and the next ingest waits for the rebuild. The log shows `ai routing reloaded` with the new routes; a failed rebuild logs `ai routing reload failed, keeping the previous routes` and the daemon keeps working with the old ones. Changing a model in Settings → KI-Modelle & Routing therefore reaches a running daemon within seconds (no `pm2 restart` needed).

**Embedding lock.** `kortex.user_settings.embedding_lock` pins the model the user's vectors are made with. Whoever embeds first (web ingest, md-sync, MCP) pins it; from then on every writer and every search query uses exactly that model, whatever the routing or the catalog says later, and each chunk records it in `item_chunks.metadata.embedding_model`. To switch models, re-embed explicitly:

```bash
pnpm --filter @kortex/md-sync reembed
```

That is a dry run (chunks, token and cost estimate). `-- --to openrouter:<model> --yes` (or set the exact model in Settings → KI-Modelle & Routing and run with `-- --yes`) rewrites every chunk vector with the new model and then moves the lock. Searches keep working during the run (items not yet rewritten fall back to full-text).

```
file saved ──► engine push ──► VaultIngestor (debounce 3 s, serial)
                                  │ pipeline.ingest(rawText = body, typeHint = type, manualTags = tags)
                                  ▼
       applyEnrichment (compare-and-set on local_file_hash) ─► replaceChunks ─► open tasks ─► tag usage
                                  │
                                  ▼ Realtime ─► engine pulls the row ─► file frontmatter gets tags/status/metadata
```

- **Written**: `summary`, `tags` (existing ∪ AI), `entities`, `related_item_ids`, `status`, `metadata` (adapter facts, `ai_title`, `ingest.{state, content_checksum, attempts, ...}`), `item_chunks` with embeddings, open `action_items` (not for `ai_chat`: an agent's "next steps" are not your tasks), `tags.usage_count` for new tags.
- **Never written**: `title`, `slug`, body. The file stays your Markdown; the adapter's rewritten version (e.g. "Key Takeaways") only feeds the chunks, the takeaways also land in `metadata.takeaways`.
- **Manual placement** (rule 3): `folder_path`/`cluster_name` change only when `is_manual_placement` is false, i.e. for inbox captures. Files created in `40_AI_Memories` are manual placements, so memories stay there. An inbox file the organizer files away moves in the vault too (the engine pulls the new `folder_path`); a new sub-folder gets its `folders` rows.
- **Gates (same as `/api/ingest`)**, checked before every pipeline run:
  - **Connectors:** an item whose type belongs to a connector switched off in Settings → Connectors (`user_settings.enabled_connectors`, e.g. `ai_chat` for agent memories) is skipped without an AI call. Plain notes belong to no connector and always run.
  - **Daily AI budget:** when today's spend in `kortex.ai_usage` reached `user_settings.daily_ai_budget_eur`, the item is skipped, logged (`ai ingest postponed`) and checked again every hour, so it runs once the budget is raised or the next day starts.
  - **Usage:** every model call of the pipeline (organizer, takeaways, embeddings) writes an `ai_usage` row with provider, task, model, tokens and the cost estimate, priced like the web server (`@kortex/ai-core` `usage/`).
  - **Auto-place threshold:** if the organizer's confidence is below `user_settings.auto_place_threshold` (or the threshold is 1, "always review"), the file stays where it is (usually `00_Inbox`) and the target is only proposed in `metadata.placement.folder_path` (`held: true`). The web Inbox shows it under "Zur Prüfung" with that target; confirming moves it, and md-sync then moves the file.
- **Idempotent**: keyed by a checksum of the body (`metadata.ingest.content_checksum`). Frontmatter-only edits and the engine pulling the enriched row back never re-run it; a body edit does (once, after the debounce).
- **Race-safe**: if the file changes while the models run, the compare-and-set fails and the newer version is processed instead.
- **Failures**: retried (30 s, 60 s, …) up to 3 times, then `status: error` + `metadata.ingest.error`. Organizer outages give a "degraded" result (saved, chunks embedded, `status: inbox`). On every daemon start, `backfill()` re-queues items in scope that were never enriched, changed offline, failed or degraded.
- Only **local** pushes trigger it. Items created in the web app or via MCP are enriched there, not twice here.

## `agents.md` in the vault (`src/agents-file.ts`)

The daemon writes `<vault>/agents.md` for agents that read the vault directly (Claude Code, Codex, Cursor opened on `~/KortexVault`): the agents guide from `@kortex/mcp-server/agents-guide` (folders and what goes where, domain objects, frontmatter, MCP tools) plus the **folder index of this vault** (every folder with its number of `.md` files). It is written on start and again 30 s after sync activity has calmed down (reconciles, pushes, pulls, removals), and only when the content changed (no timestamp, so no churn). The file is never synced as an item (it stays out of `00_Inbox`); editing it by hand is pointless, the next refresh overwrites it. Off: `KORTEX_SYNC_AGENTS_FILE=0`.

## Heartbeat and the web Sync button (`src/heartbeat.ts`)

The daemon reports itself in `kortex.sync_status`, one row per user and device (service role; the web app reads its own rows):

- **What:** device id and name, vault path, daemon version (`version` from this package's `package.json`, the shared client version), state (`running` / `stopped`), Realtime state (`connected` / `disconnected`, known from the start), last sync, last successful reconcile, last error, pending local deletes, pending AI ingest, tracked files, last reconcile stats.
- **When:** every 60 s, and 2 s after sync activity (pushes, pulls, reconciles, errors). On a clean stop (Ctrl+C, `pm2 stop`) the row says `stopped`; a crash leaves `running` with an old `last_heartbeat_at`, which the web settings show as stale.
- **Sync button:** the web settings set `sync_requested_at` on the device's row. The daemon sees that via Realtime on its own row (or on the next beat as a fallback), runs one full reconcile, and writes `sync_handled_at`.
- **Off:** `KORTEX_SYNC_HEARTBEAT=0`. Device id/name: `KORTEX_DEVICE_ID`, `KORTEX_DEVICE_NAME` (see Environment).

A healthy start logs `heartbeat on {"device":"<host>.<hash>"}` after `md-sync running`.

## Dropzone (`src/dropzone.ts`)

Non-Markdown files (PDF, EPUB, images, audio, `.eml`, `.txt`) dropped into `<vault>/00_Inbox/Dropzone/` are handed to Kortex once stable: bytes to Storage, inbox item plus `ingest_jobs` row (the web worker does OCR, transcript, organizer). Dedup is the SHA-256 of the file (`content_hash`) through the `@kortex/db` dedup module: a duplicate creates no item but still counts as handled. Handled files are moved to `.processed/YYYY-MM-DD/`, failures to `.failed/` with an `.error.txt` (never deleted). Env: `KORTEX_SYNC_DROPZONE` (`0` = off), `KORTEX_SYNC_DROPZONE_MAX_MB`, `KORTEX_SYNC_DROPZONE_TYPES`; the daily AI budget gate applies. Counters are in the heartbeat stats (`dropzone_*`).

## Local services (md-sync + MCP)

Two single-user background processes on your PC, both configured from the repo root `.env` / `.env.local` (gitignored; template in `.env.example`):

| Service | Start | Talks to |
| --- | --- | --- |
| md-sync daemon | `pm2 start packages/md-sync/ecosystem.config.cjs` (or `pnpm --filter @kortex/md-sync start`) | Supabase (service role) + Realtime, `KORTEX_VAULT_PATH`, the ADR-06 providers (ingest) |
| MCP server, HTTP on `127.0.0.1:3333` | `pnpm --filter @kortex/mcp-server build`, then `pm2 start "node --env-file=C:/dev/kortex/.env.local C:/dev/kortex/packages/mcp-server/dist/cli.mjs --http" --name kortex-mcp` | Supabase (user JWT or service role), the ADR-06 providers (query embeddings, optional organizer) |

| Variable | md-sync | MCP server |
| --- | --- | --- |
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `KORTEX_USER_ID` | required | required |
| `SUPABASE_SERVICE_ROLE_KEY` | required | alternative to the JWT pair (hybrid search via the service-role RPC) |
| `SUPABASE_ANON_KEY` + `SUPABASE_JWT_SECRET` | – | preferred: RLS applies |
| `KORTEX_VAULT_PATH` | required | – |
| `ANTHROPIC_API_KEY` (alias `CLAUDE_API_KEY`), `OPENROUTER_API_KEY`, `EDENAI_API_KEY` | ingest | query embeddings, organizer |
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

How they meet: an agent calls `brain_log_agent_memory` → row in Supabase → Realtime → md-sync writes `40_AI_Memories/YYYY-MM-DD_topic.md`. Or the agent writes that file itself (playbook 5.3) → md-sync pushes and enriches it → `brain_search` finds it through its chunk embeddings.

## Daily use on Windows

Run **exactly one** md-sync per vault (two daemons on one vault fight over `.kortex/state.json`). Everything reads `C:\dev\kortex\.env.local`; nothing secret goes into PM2 or Task Scheduler.

**Option A: PM2 (recommended: restarts on crash, keeps logs).** One-time setup in PowerShell:

```powershell
npm install -g pm2 pm2-windows-startup
pm2-startup install                                   # starts PM2 (and the saved list) at logon
cd C:\dev\kortex
pm2 start packages/md-sync/ecosystem.config.cjs        # md-sync daemon
pnpm --filter @kortex/mcp-server build                 # only if you use MCP over HTTP
pm2 start "node --env-file=C:/dev/kortex/.env.local C:/dev/kortex/packages/mcp-server/dist/cli.mjs --http" --name kortex-mcp
pm2 save                                              # remember the list for the next logon
```

Day to day: `pm2 status`, `pm2 logs kortex-md-sync --lines 50`, `pm2 restart kortex-md-sync` (after `git pull` + `pnpm install`), `pm2 stop all`. A healthy start logs `vault bootstrapped` (first run only), `ai routing …`, `realtime connected`, `reconciled …`, `md-sync running`, `heartbeat on …`. Routing changes don't need a restart (see "Routing changes apply without a restart"); code updates do.

**Option B: Task Scheduler (no PM2), md-sync only,** started at logon without a console window. In PowerShell:

```powershell
$a = New-ScheduledTaskAction -Execute "node.exe" -Argument "C:\dev\kortex\packages\md-sync\node_modules\tsx\dist\cli.mjs src\cli.ts" -WorkingDirectory "C:\dev\kortex\packages\md-sync"
$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$s = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName "Kortex md-sync" -Action $a -Trigger $t -Settings $s -Principal $p
```

`S4U` runs it hidden in the background (no window); output is not kept, so use PM2 if you want logs. Not tried on this PC: if `Register-ScheduledTask` reports access denied, run that PowerShell as administrator, or leave out `-Principal $p` (the task then runs in your session with a visible console window). Stop/start: `Stop-ScheduledTask "Kortex md-sync"` / `Start-ScheduledTask "Kortex md-sync"`; remove: `Unregister-ScheduledTask "Kortex md-sync"`.

Without any service: `cd C:\dev\kortex; pnpm --filter @kortex/md-sync start` in a terminal you keep open (Ctrl+C stops it cleanly).

## Live status (2026-10-23, WP-F)

Ran against the real account and `C:/Users/max/KortexVault` with `[KORTEX-TEST]` data in `00_Inbox/_kortex-test/` and `40_AI_Memories/_kortex-test-*.md`; everything was removed again and the account is back to its pre-test state.

- **First start:** created the default tree (`00_Inbox` … `90_Digests`, `10_Notes/Daily`, `70_Objects/*`, `.kortex/`), mirrored the 17 system folders, connected to Realtime, and pinned the user's embedding lock on the routed model.
- **Cloud → local:** a row inserted in the DB showed up as a file with correct frontmatter + checksum in under 1 s; cloud edits were applied in place, also after a local move.
- **Local → cloud:** new files → rows (id written back), `is_manual_placement` set outside `00_Inbox`, folder rows for new sub-folders; edits, rename (slug) and move (folder) pushed; delete → `archived` after 2.5 s; remote deletes → local files to `.kortex/trash/`.
- **Conflict:** offline edits on both sides → newer (cloud) won, local kept as `<name>.conflict-<ts>.md`.
- **Ingest:** a `40_AI_Memories` file was enriched (Haiku via routing: summary, 3 tags, 1 chunk embedded with the locked model); a frontmatter-only edit did not re-run it.
- **Realtime:** a forced socket drop reconnected after ~0.7 s; the reconnect loop described above was found and fixed here.
- **Known, harmless:** rows created by the web app/DB keep `local_file_hash = null` and `folder_id` is not backfilled by md-sync; a locally edited file keeps its old frontmatter `checksum` until the next pull (by design, so an open editor is never overwritten). The local clock was ~0.3 s behind the server: conflicts compare file mtime with `updated_at`, so keep Windows time sync on.
