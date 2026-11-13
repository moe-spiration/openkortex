-- S1 types-registry: the one foundation migration for the next expansion stage. Additive only.
--
-- (a) knowledge_items.type accepts the 9 new types (movie, book, product, place, snippet,
--     inspiration, receipt, prompt, session). Still no extra tables: type-specific fields live in
--     metadata JSONB (+ YAML frontmatter), see packages/db/src/type-registry.ts (single source).
-- (b) knowledge_items.remind_at (+ partial index) for snooze / resurfacing.
-- (c) action_items: project link, timeframe, context, export state, external reference.
-- (d) Dedup preparation: knowledge_items.source_url_norm and content_hash. The columns start NULL
--     for all existing rows, so the partial UNIQUE index cannot be violated by existing data; the
--     dedup module (S2) fills them. content_hash stays non-unique (identical content in two
--     places is legitimate, a hit is only a merge hint).
-- (e) _bootstrap_user creates the vault folders of the new types; existing users get them below.
-- RLS is unchanged (auth.uid() = user_id on all touched tables). Idempotent, drops no data.

-- (a) type CHECK ---------------------------------------------------------------------------
alter table kortex.knowledge_items drop constraint if exists knowledge_items_type_check;
alter table kortex.knowledge_items add constraint knowledge_items_type_check check (
  type in (
    'note', 'daily_note', 'article', 'meeting', 'video', 'podcast', 'recipe',
    'ai_chat', 'image', 'voice', 'pdf', 'epub', 'social',
    'email', 'bookmark', 'digest',
    'person', 'project', 'organization', 'concept', 'tool', 'asset', 'goal',
    'movie', 'book', 'product', 'place', 'snippet', 'inspiration', 'receipt', 'prompt', 'session'
  )
);

-- (b) reminder -----------------------------------------------------------------------------
alter table kortex.knowledge_items add column if not exists remind_at timestamptz;
create index if not exists idx_items_remind_at
  on kortex.knowledge_items (user_id, remind_at)
  where remind_at is not null;

-- (c) richer tasks -------------------------------------------------------------------------
alter table kortex.action_items
  add column if not exists project_item_id uuid references kortex.knowledge_items (id) on delete set null,
  add column if not exists timeframe text,
  add column if not exists context text,
  add column if not exists exported_at timestamptz,
  add column if not exists external_ref text;
create index if not exists idx_action_items_project
  on kortex.action_items (project_item_id)
  where project_item_id is not null;

-- (d) dedup preparation --------------------------------------------------------------------
alter table kortex.knowledge_items
  add column if not exists source_url_norm text,
  add column if not exists content_hash text;
-- Unique per user and normalised URL (NULL = not normalised yet, never conflicts).
create unique index if not exists uq_items_user_source_url_norm
  on kortex.knowledge_items (user_id, source_url_norm)
  where source_url_norm is not null;
create index if not exists idx_items_user_content_hash
  on kortex.knowledge_items (user_id, content_hash)
  where content_hash is not null;

-- (e) system folders of the new types ------------------------------------------------------
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

  -- System sub-folders (same list as DOMAIN_OBJECT_FOLDERS + the typed folders in packages/db/src/type-registry.ts)
  insert into kortex.folders (user_id, parent_id, name, slug, folder_path, icon, sort_order, is_system_default)
  select p_user_id, p.id, c.name, c.slug, c.parent_path || '/' || c.name, c.icon, c.sort_order, true
  from (values
    ('10_Notes',       'Daily',         'daily',         'calendar-days',        0),
    ('70_Objects',     'People',        'people',        'user',                 0),
    ('70_Objects',     'Projects',      'projects',      'folder-kanban',        1),
    ('70_Objects',     'Organizations', 'organizations', 'building-2',           2),
    ('70_Objects',     'Concepts',      'concepts',      'lightbulb',            3),
    ('70_Objects',     'Tools',         'tools',         'wrench',               4),
    ('70_Objects',     'Assets',        'assets',        'gem',                  5),
    ('70_Objects',     'Goals',         'goals',         'target',               6),
    ('30_Clippings',   'Movies',        'movies',        'clapperboard',         0),
    ('30_Clippings',   'Products',      'products',      'shopping-bag',         1),
    ('30_Clippings',   'Places',        'places',        'map-pin',              2),
    ('30_Clippings',   'Inspiration',   'inspiration',   'sparkles',             3),
    ('30_Clippings',   'Sessions',      'sessions',      'layout-list',          4),
    ('40_AI_Memories', 'Prompts',       'prompts',       'message-square-code',  0),
    ('40_AI_Memories', 'Snippets',      'snippets',      'code',                 1),
    ('60_Documents',   'Books',         'books',         'book-marked',          0),
    ('60_Documents',   'Receipts',      'receipts',      'receipt',              1)
  ) as c (parent_path, name, slug, icon, sort_order)
  join kortex.folders p
    on p.user_id = p_user_id and p.folder_path = c.parent_path
  on conflict (user_id, folder_path) do nothing;
end;
$$;

-- Existing users: add the new system folders (idempotent; only users that were bootstrapped already).
insert into kortex.folders (user_id, parent_id, name, slug, folder_path, icon, sort_order, is_system_default)
select p.user_id, p.id, c.name, c.slug, c.parent_path || '/' || c.name, c.icon, c.sort_order, true
from (values
  ('30_Clippings',   'Movies',      'movies',      'clapperboard',         0),
  ('30_Clippings',   'Products',    'products',    'shopping-bag',         1),
  ('30_Clippings',   'Places',      'places',      'map-pin',              2),
  ('30_Clippings',   'Inspiration', 'inspiration', 'sparkles',             3),
  ('30_Clippings',   'Sessions',    'sessions',    'layout-list',          4),
  ('40_AI_Memories', 'Prompts',     'prompts',     'message-square-code',  0),
  ('40_AI_Memories', 'Snippets',    'snippets',    'code',                 1),
  ('60_Documents',   'Books',       'books',       'book-marked',          0),
  ('60_Documents',   'Receipts',    'receipts',    'receipt',              1)
) as c (parent_path, name, slug, icon, sort_order)
join kortex.folders p on p.folder_path = c.parent_path and p.is_system_default
on conflict (user_id, folder_path) do nothing;
