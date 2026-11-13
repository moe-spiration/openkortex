# @kortex/db

Database schema, migrations and a typed Supabase client for OpenKortex.

## Where the data lives

- Supabase (Postgres with pgvector). Everything lives in its own Postgres schema **`kortex`**, so the
  database can be shared with other apps; nothing goes into `public`.
  - Tables: `folders`, `tags`, `knowledge_items`, `item_highlights`, `item_chunks`, `action_items`,
    `user_settings`, `ai_model_catalog` and more (see `supabase/migrations`).
  - Storage buckets (private): `kortex-documents`, `kortex-media`, `kortex-audio`. Object keys start
    with the owner's user id: `{user_id}/…`.
  - Realtime: `kortex.knowledge_items`, `kortex.folders`, `kortex.action_items` are in the
    `supabase_realtime` publication.
- No trigger on `auth.users`. After sign-in the app calls `kortex.bootstrap_user()`
  (`bootstrapUser(client)`), which creates the user's `user_settings` row and the system folders.
  Server daemons with the service role call `kortex._bootstrap_user(user_id)`.
- PostgREST must expose the schema: `PGRST_DB_SCHEMAS` includes `kortex` (the self-hosting stack sets
  it). PostgREST refuses to serve while a listed schema does not exist, so create the schema first.

## Usage

```ts
import { createKortexClient, bootstrapUser, matchKnowledgeHybrid } from "@kortex/db";

const db = createKortexClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
await bootstrapUser(db); // once per sign-in, idempotent
const hits = await matchKnowledgeHybrid(db, { queryText: "mcp sync", queryEmbedding, matchCount: 10 });
```

The client is always bound to `db: { schema: "kortex" }`. Domain vocabulary is exported from
`src/domain.ts`, item types from `src/type-registry.ts`, duplicate detection from `src/dedup.ts`, the
per-task AI routing (types, Zod schemas, defaults, helpers) from `src/routing.ts`, and the model
catalog loaders from `src/catalog.ts`. Embeddings are fixed at 1536 dimensions
(`item_chunks.embedding vector(1536)`).

## Migrations

New schema changes are new files `supabase/migrations/<yyyymmddhhmmss>_<name>.sql` (no
`begin`/`commit`: each file runs in one transaction). Every migration has to work on an empty
database.

- **Self-hosting stack:** the `migrate` service (`selfhost/migrate.sh`) applies pending files in order
  on every start and records them in `supabase_migrations.schema_migrations`, the table the Supabase
  CLI uses.
- **Another Supabase:** `pnpm --filter @kortex/db db:push` runs `supabase db push --db-url
  $SUPABASE_DB_URL`. The other `db:*` scripts (`db:tunnel`, `db:apply`, `db:types`, `db:verify`) reach a
  Docker-hosted Supabase over SSH; their settings (`KORTEX_SSH_HOST`, `KORTEX_SSH_KEY`, …) are
  described in the root `.env.example` and in `scripts/db.mjs`.

## Rules

- Never touch other apps' objects in `public`, `storage` (only `kortex-*` buckets and `kortex:`
  policies) or `auth`.
- Row level security on every table: `(select auth.uid()) = user_id` in `USING` and `WITH CHECK`, `TO
  authenticated`. `anon` has no grants on `kortex`.
- Server code using the service role bypasses row level security and must always filter by
  `user_id`.
