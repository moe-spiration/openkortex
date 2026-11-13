-- WP-A (ADR-06): one embedding model per user, and hybrid search that only compares vectors of
-- that model. Additive, schema kortex only.
--
-- 1. kortex.user_settings.embedding_lock: the embedding model the user's vectors were made with,
--      { "provider": "openrouter"|"edenai", "model_id": "<exact id>", "dimensions": 1536,
--        "locked_at": "<iso timestamp>" }
--    Written once, on the first embedding (compare-and-set on `embedding_lock is null`). Every
--    writer and every search query embeds with this model, whatever ai_routing_config.embeddings
--    says later. Changing it needs an explicit re-embed (md-sync `reembed` script), which
--    rewrites all chunks and then moves the lock.
-- 2. Every chunk carries its model in item_chunks.metadata.embedding_model
--    ("<provider>:<model_id>", set by ai-core).
-- 3. match_knowledge_hybrid gets an optional `filter_embedding_model`: when set, the vector side
--    only looks at chunks of that model (the full-text side is unaffected). Same body now lives in
--    kortex._match_knowledge_hybrid(p_user_id, ...), which also backs the new service-role variant
--    match_knowledge_hybrid_for_user (md-sync / MCP without a user JWT).

-- 1. Lock column -------------------------------------------------------------------------------

alter table kortex.user_settings
  add column if not exists embedding_lock jsonb;

alter table kortex.user_settings
  drop constraint if exists user_settings_embedding_lock_check;
alter table kortex.user_settings
  add constraint user_settings_embedding_lock_check check (
    embedding_lock is null
    or (
      jsonb_typeof(embedding_lock) = 'object'
      and embedding_lock ->> 'provider' in ('openrouter', 'edenai')
      and coalesce(length(embedding_lock ->> 'model_id'), 0) between 1 and 200
      and embedding_lock ->> 'dimensions' = '1536'
    )
  );

comment on column kortex.user_settings.embedding_lock is
  'Embedding model of this user''s vectors: { provider, model_id, dimensions: 1536, locked_at }. Set on first embedding; change only via re-embed. Wins over ai_routing_config.embeddings.';

-- 2. Chunk model lookup (search filter, re-embed progress) ---------------------------------------

create index if not exists idx_item_chunks_user_embedding_model
  on kortex.item_chunks (user_id, (metadata ->> 'embedding_model'));

-- 3. Hybrid search -------------------------------------------------------------------------------

-- Shared body. SECURITY INVOKER: RLS still applies for authenticated callers, so passing another
-- user's id returns nothing; the service role relies on p_user_id alone.
create or replace function kortex._match_knowledge_hybrid(
  p_user_id uuid,
  query_text text,
  query_embedding extensions.vector(1536),
  match_count int default 10,
  filter_type text default null,
  filter_folder_path text default null,
  rrf_k int default 60,
  filter_embedding_model text default null
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
    p_user_id as uid,
    case when coalesce(trim(query_text), '') = '' then null
         else websearch_to_tsquery('simple'::regconfig, query_text) end as tsq
),
scoped_items as (
  select k.*
  from kortex.knowledge_items k, params p
  where p.uid is not null
    and k.user_id = p.uid
    and (filter_type is null or k.type = filter_type)
    and (
      filter_folder_path is null
      or k.folder_path = filter_folder_path
      or k.folder_path like filter_folder_path || '/%'
    )
),
-- nearest chunks (of the query's embedding model), then keep the best chunk per item
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
    and (filter_embedding_model is null or c.metadata ->> 'embedding_model' = filter_embedding_model)
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

-- The public RPC keeps its name and its first six parameters (callers use named arguments), plus
-- the optional model filter. Replacing it needs a drop because the signature grows.
drop function if exists kortex.match_knowledge_hybrid(text, extensions.vector, int, text, text, int);

create or replace function kortex.match_knowledge_hybrid(
  query_text text,
  query_embedding extensions.vector(1536),
  match_count int default 10,
  filter_type text default null,
  filter_folder_path text default null,
  rrf_k int default 60,
  filter_embedding_model text default null
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
  select * from kortex._match_knowledge_hybrid(
    auth.uid(), query_text, query_embedding, match_count, filter_type, filter_folder_path,
    rrf_k, filter_embedding_model);
$$;

-- Service role only (md-sync, MCP server without a user JWT): explicit user scope.
create or replace function kortex.match_knowledge_hybrid_for_user(
  p_user_id uuid,
  query_text text,
  query_embedding extensions.vector(1536),
  match_count int default 10,
  filter_type text default null,
  filter_folder_path text default null,
  rrf_k int default 60,
  filter_embedding_model text default null
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
  select * from kortex._match_knowledge_hybrid(
    p_user_id, query_text, query_embedding, match_count, filter_type, filter_folder_path,
    rrf_k, filter_embedding_model);
$$;

-- Function privileges: nothing for anon / public (new functions get EXECUTE for PUBLIC by default).
revoke execute on function kortex._match_knowledge_hybrid(uuid, text, extensions.vector, int, text, text, int, text) from public, anon;
revoke execute on function kortex.match_knowledge_hybrid(text, extensions.vector, int, text, text, int, text) from public, anon;
revoke execute on function kortex.match_knowledge_hybrid_for_user(uuid, text, extensions.vector, int, text, text, int, text) from public, anon, authenticated;
grant execute on function kortex._match_knowledge_hybrid(uuid, text, extensions.vector, int, text, text, int, text) to authenticated, service_role;
grant execute on function kortex.match_knowledge_hybrid(text, extensions.vector, int, text, text, int, text) to authenticated, service_role;
grant execute on function kortex.match_knowledge_hybrid_for_user(uuid, text, extensions.vector, int, text, text, int, text) to service_role;

notify pgrst, 'reload schema';
