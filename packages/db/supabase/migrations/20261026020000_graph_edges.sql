-- WP-J (graph live): server-side edge aggregation for the knowledge graph. Additive, schema
-- kortex only, no table changes.
--
-- 1. kortex.graph_wiki_edges: [[Wiki-Links]] of content_md resolved to item ids by title, computed
--    in the database so no item body ever travels to the web server just to find links.
-- 2. kortex.graph_semantic_edges: item-to-item similarity for "semantic" edges. Each item is
--    represented by the centroid of its chunk embeddings; its nearest chunks (HNSW index) belong to
--    its nearest items. Cost is bounded: p_item_limit centroids x one index probe of p_k * 6 chunks.
--    The web server caches the result per user and invalidates it when items change.
--
-- Both are SECURITY INVOKER: RLS applies for authenticated callers, the explicit p_user_id scope
-- serves the service role.

create or replace function kortex.graph_wiki_edges(
  p_user_id uuid,
  p_item_limit int default 5000
)
returns table (source_id uuid, target_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with scope as (
    select id, title, content_md
    from kortex.knowledge_items
    where user_id = p_user_id and status <> 'archived'
    order by updated_at desc
    limit greatest(1, least(p_item_limit, 10000))
  ),
  links as (
    select s.id as source_id,
           lower(btrim(split_part(split_part(mt.m[1], '|', 1), '#', 1))) as target_title
    from scope s
    cross join lateral regexp_matches(s.content_md, '\[\[([^\]\n]+)\]\]', 'g') as mt(m)
  ),
  titles as (
    select distinct on (lower(title)) lower(title) as t, id
    from scope
    order by lower(title), id
  )
  select distinct l.source_id, t.id as target_id
  from links l
  join titles t on t.t = l.target_title
  where t.id <> l.source_id;
$$;

create or replace function kortex.graph_semantic_edges(
  p_user_id uuid,
  p_k int default 3,
  p_min_similarity real default 0.75,
  p_item_limit int default 2000,
  p_embedding_model text default null
)
returns table (item_a uuid, item_b uuid, similarity real)
language sql
stable
security invoker
set search_path = ''
as $$
  with scope as (
    select id
    from kortex.knowledge_items
    where user_id = p_user_id and status <> 'archived'
    order by updated_at desc
    limit greatest(1, least(p_item_limit, 5000))
  ),
  centroids as (
    select c.item_id, extensions.avg(c.embedding) as v
    from kortex.item_chunks c
    join scope s on s.id = c.item_id
    where c.user_id = p_user_id
      and c.embedding is not null
      and (p_embedding_model is null or c.metadata ->> 'embedding_model' = p_embedding_model)
    group by c.item_id
  ),
  probes as (
    select ce.item_id as a, nb.item_id as b, 1 - (nb.embedding operator(extensions.<=>) ce.v) as sim
    from centroids ce
    cross join lateral (
      select ch.item_id, ch.embedding
      from kortex.item_chunks ch
      where ch.user_id = p_user_id
        and ch.item_id <> ce.item_id
        and ch.embedding is not null
        and (p_embedding_model is null or ch.metadata ->> 'embedding_model' = p_embedding_model)
      order by ch.embedding operator(extensions.<=>) ce.v
      limit greatest(1, least(p_k, 10)) * 6
    ) nb
  ),
  best as (
    select a, b, max(sim) as sim from probes group by a, b
  ),
  ranked as (
    select a, b, sim, row_number() over (partition by a order by sim desc) as rn
    from best
    where sim >= p_min_similarity
  )
  select least(a, b) as item_a, greatest(a, b) as item_b, max(sim)::real as similarity
  from ranked
  where rn <= greatest(1, least(p_k, 10))
  group by least(a, b), greatest(a, b)
  order by max(sim) desc
  limit 20000;
$$;

revoke execute on function kortex.graph_wiki_edges(uuid, int) from public, anon;
revoke execute on function kortex.graph_semantic_edges(uuid, int, real, int, text) from public, anon;
grant execute on function kortex.graph_wiki_edges(uuid, int) to authenticated, service_role;
grant execute on function kortex.graph_semantic_edges(uuid, int, real, int, text) to authenticated, service_role;

notify pgrst, 'reload schema';
