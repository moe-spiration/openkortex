-- =============================================================================
-- Kortex initial schema
--
-- The self-hosted Supabase instance is shared with other apps, so everything
-- Kortex owns lives in its own `kortex` schema (never in `public`), and storage
-- buckets are prefixed with `kortex-`. There is deliberately NO trigger on the
-- shared `auth.users` table: the app calls `kortex.bootstrap_user()` on first
-- login to create the user's settings row and system default folders.
--
-- PostgREST must expose the schema (PGRST_DB_SCHEMAS += kortex) and clients
-- use `db: { schema: 'kortex' }`.
-- =============================================================================

-- 1. Extensions (Supabase keeps extensions in the `extensions` schema) --------
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists kortex;
comment on schema kortex is 'Kortex AI-native Second Brain';

-- updated_at trigger helper
create or replace function kortex.handle_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Hierarchical folders ------------------------------------------------------
create table kortex.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references kortex.folders (id) on delete cascade,
  name text not null,
  slug text not null,
  folder_path text not null,
  icon text default 'folder', -- Lucide icon name
  color text,
  sort_order int default 0,
  is_system_default boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, folder_path)
);
create index idx_folders_user_parent on kortex.folders (user_id, parent_id);

-- 3. Tag taxonomy (manual + AI-learned) ---------------------------------------
create table kortex.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text default '#6366F1',
  is_manual boolean default false,
  usage_count int default 1,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
-- (user_id, name) is already indexed by the unique constraint.

-- 4. knowledge_items: captures, notes, nested pages and domain objects --------
create table kortex.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_item_id uuid references kortex.knowledge_items (id) on delete set null,
  folder_id uuid references kortex.folders (id) on delete set null,

  type text not null default 'note' check (
    type in (
      'note', 'daily_note', 'article', 'meeting', 'video', 'podcast', 'recipe',
      'ai_chat', 'image', 'voice', 'pdf', 'epub', 'social',
      'email', 'bookmark', 'digest',
      'person', 'project', 'organization', 'concept', 'tool', 'asset', 'goal'
    )
  ),
  source_platform text not null default 'manual',

  title text not null,
  slug text not null,
  summary text,
  content_md text not null default '',
  source_url text,

  file_storage_path text,
  file_mime_type text,
  file_size_bytes bigint,
  reading_state jsonb default '{}'::jsonb,

  cover_image_url text,
  icon text default 'file-text', -- Lucide icon name
  cluster_name text default 'General',
  folder_path text not null default '00_Inbox',
  is_manual_placement boolean default false,

  tags text[] default '{}',
  entities text[] default '{}',
  related_item_ids uuid[] default '{}',
  flashcards jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,

  status text not null default 'inbox'
    check (status in ('inbox', 'processing', 'processed', 'error', 'archived')),
  local_file_hash text,
  is_pinned boolean default false,
  is_favorite boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Weighted full-text column: title = A, summary = B, content = C
alter table kortex.knowledge_items
  add column fts tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(content_md, '')), 'C')
  ) stored;

create index idx_knowledge_items_fts on kortex.knowledge_items using gin (fts);
create index idx_knowledge_items_tags on kortex.knowledge_items using gin (tags);
create index idx_knowledge_items_entities on kortex.knowledge_items using gin (entities);
create index idx_knowledge_items_user_status on kortex.knowledge_items (user_id, status, type);
create index idx_knowledge_items_cluster on kortex.knowledge_items (user_id, cluster_name);
create index idx_knowledge_items_folder on kortex.knowledge_items (user_id, folder_path);
create index idx_knowledge_items_parent on kortex.knowledge_items (user_id, parent_item_id);
create index idx_knowledge_items_updated on kortex.knowledge_items (user_id, updated_at desc);
-- Fuzzy title lookup (quick switcher, [[Wiki-Link]] resolution)
create index idx_knowledge_items_title_trgm
  on kortex.knowledge_items using gin (title extensions.gin_trgm_ops);

-- 5. Highlights & annotations (web clipper, PDF + EPUB reader) ----------------
create table kortex.item_highlights (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references kortex.knowledge_items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  quote_text text not null,
  note_text text,
  color text default 'yellow',
  locator jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_item_highlights_item on kortex.item_highlights (user_id, item_id);

-- 6. Vector chunks for hybrid RAG ---------------------------------------------
create table kortex.item_chunks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references kortex.knowledge_items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_index int not null,
  chunk_heading text,
  page_or_timestamp text,
  chunk_text text not null,
  embedding extensions.vector(1536),
  metadata jsonb default '{}'::jsonb
);
create index idx_item_chunks_embedding
  on kortex.item_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index idx_item_chunks_user_item on kortex.item_chunks (user_id, item_id);

-- 7. Action items & tasks ------------------------------------------------------
create table kortex.action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_item_id uuid references kortex.knowledge_items (id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date timestamptz,
  assignee text default 'Me',
  source_timestamp_sec int,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_action_items_user_status on kortex.action_items (user_id, status, due_date);
create index idx_action_items_source on kortex.action_items (source_item_id);

-- 8. User settings & model configuration -------------------------------------
create table kortex.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferred_chat_model text not null default 'anthropic/claude-3.7-sonnet',
  preferred_fast_model text not null default 'google/gemini-2.5-flash',
  embedding_model text not null default 'openai/text-embedding-3-small',
  auto_tag_enabled boolean not null default true,
  auto_cluster_enabled boolean not null default true,
  weekly_digest_day int not null default 5,
  custom_taxonomy jsonb default '[]'::jsonb,
  enabled_connectors text[] default array['web', 'youtube', 'pdf', 'epub', 'recipe', 'meeting', 'ai_chat'],
  subscription_tier text not null default 'founder',
  updated_at timestamptz not null default now()
);

-- updated_at triggers
create trigger set_folders_updated_at before update on kortex.folders
  for each row execute function kortex.handle_updated_at();
create trigger set_knowledge_items_updated_at before update on kortex.knowledge_items
  for each row execute function kortex.handle_updated_at();
create trigger set_user_settings_updated_at before update on kortex.user_settings
  for each row execute function kortex.handle_updated_at();

-- 9. Grants + Row Level Security ----------------------------------------------
-- anon gets nothing. authenticated is limited by RLS; service_role bypasses RLS.
grant usage on schema kortex to authenticated, service_role;
grant select, insert, update, delete on all tables in schema kortex to authenticated;
grant all on all tables in schema kortex to service_role;
alter default privileges in schema kortex
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema kortex grant all on tables to service_role;
alter default privileges in schema kortex revoke execute on functions from public;

alter table kortex.folders enable row level security;
alter table kortex.tags enable row level security;
alter table kortex.knowledge_items enable row level security;
alter table kortex.item_highlights enable row level security;
alter table kortex.item_chunks enable row level security;
alter table kortex.action_items enable row level security;
alter table kortex.user_settings enable row level security;

create policy "Users manage own folders" on kortex.folders
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage own tags" on kortex.tags
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage own knowledge_items" on kortex.knowledge_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Child rows must also point at one of the user's own items (foreign keys
-- bypass RLS, so without this a user could attach rows to someone else's item).
create policy "Users manage own item_highlights" on kortex.item_highlights
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from kortex.knowledge_items k where k.id = item_id)
  );

create policy "Users manage own item_chunks" on kortex.item_chunks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from kortex.knowledge_items k where k.id = item_id)
  );

create policy "Users manage own action_items" on kortex.action_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage own user_settings" on kortex.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 10. Lazy user bootstrap (settings row + system default folders) -------------
-- Internal worker; callable by service_role (md-sync / MCP server) for a given user.
create or replace function kortex._bootstrap_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'kortex._bootstrap_user: user id is required';
  end if;

  insert into kortex.user_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- Top-level system folders
  insert into kortex.folders (user_id, parent_id, name, slug, folder_path, icon, sort_order, is_system_default)
  select p_user_id, null, f.name, f.slug, f.name, f.icon, f.sort_order, true
  from (values
    ('00_Inbox',       '00-inbox',       'inbox',          0),
    ('10_Notes',       '10-notes',       'notebook-pen',  10),
    ('20_Meetings',    '20-meetings',    'mic',           20),
    ('30_Clippings',   '30-clippings',   'scissors',      30),
    ('40_AI_Memories', '40-ai-memories', 'brain',         40),
    ('50_Recipes',     '50-recipes',     'chef-hat',      50),
    ('60_Documents',   '60-documents',   'file-text',     60),
    ('70_Objects',     '70-objects',     'boxes',         70),
    ('90_Digests',     '90-digests',     'newspaper',     90)
  ) as f (name, slug, icon, sort_order)
  on conflict (user_id, folder_path) do nothing;

  -- System sub-folders
  insert into kortex.folders (user_id, parent_id, name, slug, folder_path, icon, sort_order, is_system_default)
  select p_user_id, p.id, c.name, c.slug, c.parent_path || '/' || c.name, c.icon, c.sort_order, true
  from (values
    ('10_Notes',   'Daily',         'daily',         'calendar-days', 0),
    ('70_Objects', 'People',        'people',        'user',          0),
    ('70_Objects', 'Projects',      'projects',      'folder-kanban', 1),
    ('70_Objects', 'Organizations', 'organizations', 'building-2',    2),
    ('70_Objects', 'Concepts',      'concepts',      'lightbulb',     3),
    ('70_Objects', 'Tools',         'tools',         'wrench',        4),
    ('70_Objects', 'Assets',        'assets',        'gem',           5),
    ('70_Objects', 'Goals',         'goals',         'target',        6)
  ) as c (parent_path, name, slug, icon, sort_order)
  join kortex.folders p
    on p.user_id = p_user_id and p.folder_path = c.parent_path
  on conflict (user_id, folder_path) do nothing;
end;
$$;

-- Public entry point: bootstraps the calling user only. Idempotent.
create or replace function kortex.bootstrap_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'kortex.bootstrap_user: not authenticated';
  end if;
  perform kortex._bootstrap_user(v_uid);
end;
$$;

-- 11. Hybrid search RPC (Reciprocal Rank Fusion: vector + full text) ----------
-- SECURITY INVOKER: RLS applies, plus an explicit auth.uid() scope.
-- Either input may be null/empty; that side of the fusion is then skipped.
create or replace function kortex.match_knowledge_hybrid(
  query_text text,
  query_embedding extensions.vector(1536),
  match_count int default 10,
  filter_type text default null,
  filter_folder_path text default null,
  rrf_k int default 60
)
returns table (
  item_id uuid,
  title text,
  type text,
  source_platform text,
  summary text,
  chunk_text text,
  page_or_timestamp text,
  source_url text,
  folder_path text,
  tags text[],
  cluster_name text,
  combined_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
with params as (
  select
    auth.uid() as uid,
    case when coalesce(trim(query_text), '') = '' then null
         else websearch_to_tsquery('simple'::regconfig, query_text) end as tsq
),
scoped_items as (
  select k.*
  from kortex.knowledge_items k, params p
  where k.user_id = p.uid
    and (filter_type is null or k.type = filter_type)
    and (
      filter_folder_path is null
      or k.folder_path = filter_folder_path
      or k.folder_path like filter_folder_path || '/%'
    )
),
-- nearest chunks, then keep the best chunk per item
vector_chunks as (
  select
    c.item_id,
    c.chunk_text,
    c.page_or_timestamp,
    c.embedding operator(extensions.<=>) query_embedding as distance
  from kortex.item_chunks c
  join scoped_items k on k.id = c.item_id
  where query_embedding is not null
    and c.embedding is not null
  order by c.embedding operator(extensions.<=>) query_embedding
  limit match_count * 4
),
vector_matches as (
  select
    item_id,
    chunk_text,
    page_or_timestamp,
    row_number() over (order by distance) as rank_ix
  from (
    select distinct on (item_id) *
    from vector_chunks
    order by item_id, distance
  ) best
  order by distance
  limit match_count * 2
),
fts_matches as (
  select
    k.id as item_id,
    left(k.content_md, 1200) as chunk_text,
    null::text as page_or_timestamp,
    row_number() over (order by ts_rank_cd(k.fts, p.tsq) desc) as rank_ix
  from scoped_items k, params p
  where p.tsq is not null
    and k.fts @@ p.tsq
  order by ts_rank_cd(k.fts, p.tsq) desc
  limit match_count * 2
),
combined as (
  select
    coalesce(v.item_id, f.item_id) as item_id,
    coalesce(v.chunk_text, f.chunk_text) as chunk_text,
    coalesce(v.page_or_timestamp, f.page_or_timestamp) as page_or_timestamp,
    (coalesce(1.0 / (rrf_k + v.rank_ix), 0.0)
      + coalesce(1.0 / (rrf_k + f.rank_ix), 0.0))::double precision as score
  from vector_matches v
  full outer join fts_matches f on v.item_id = f.item_id
)
select
  k.id,
  k.title,
  k.type,
  k.source_platform,
  k.summary,
  c.chunk_text,
  c.page_or_timestamp,
  k.source_url,
  k.folder_path,
  k.tags,
  k.cluster_name,
  c.score
from combined c
join scoped_items k on k.id = c.item_id
order by c.score desc
limit match_count;
$$;

-- Function privileges: nothing for anon / public.
revoke execute on all functions in schema kortex from public, anon;
grant execute on function kortex.bootstrap_user() to authenticated;
grant execute on function kortex.match_knowledge_hybrid(text, extensions.vector, int, text, text, int)
  to authenticated, service_role;
grant execute on function kortex._bootstrap_user(uuid) to service_role;

-- 12. Private storage buckets (shared storage => kortex- prefix) --------------
-- Object keys must start with the owner's user id: `{user_id}/...`.
insert into storage.buckets (id, name, public)
values
  ('kortex-documents', 'kortex-documents', false),
  ('kortex-media', 'kortex-media', false),
  ('kortex-audio', 'kortex-audio', false)
on conflict (id) do nothing;

create policy "kortex: read own objects" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "kortex: insert own objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "kortex: update own objects" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "kortex: delete own objects" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 13. Realtime -----------------------------------------------------------------
alter publication supabase_realtime
  add table kortex.knowledge_items, kortex.folders, kortex.action_items;
