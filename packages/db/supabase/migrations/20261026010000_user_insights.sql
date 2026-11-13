-- WP-I: per-user state for Life, Insights and the weekly review.
-- Additive only, schema kortex only.
--
-- One small key/value table instead of one table per feature:
--   kind 'life_vision'  key = area key (health, career, …)   payload { text }
--   kind 'impulses'     key = ''                             payload { recommendations, lead_theme, … }
--   kind 'life_reflect' key = area key                       payload { text } (reserved for an AI reflection)
-- input_hash lets a cache entry be reused while its inputs are unchanged (impulses: 24 h TTL on top).
-- Knowledge stays Markdown: the weekly review itself is saved as a note (10_Notes/Weekly/YYYY-Www.md);
-- only derived or UI state lives here.

create table if not exists kortex.user_insights (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z_]{0,39}$'),
  key text not null default '' check (length(key) <= 120),
  payload jsonb not null default '{}'::jsonb,
  input_hash text check (input_hash is null or length(input_hash) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);

create trigger set_user_insights_updated_at before update on kortex.user_insights
  for each row execute function kortex.handle_updated_at();

alter table kortex.user_insights enable row level security;

grant select, insert, update, delete on kortex.user_insights to authenticated;
grant all on kortex.user_insights to service_role;

drop policy if exists "Users manage own user_insights" on kortex.user_insights;
create policy "Users manage own user_insights" on kortex.user_insights
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table kortex.user_insights is
  'Derived per-user state for Life/Insights/Review (area visions, cached AI impulses). Not knowledge: notes stay in knowledge_items.';
