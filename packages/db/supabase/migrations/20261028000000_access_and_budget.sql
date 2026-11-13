-- S2a "Abuse & Kosten": Kortex-own access gate and AI budget. Additive, schema kortex only
-- (plus the kortex-* storage policies). Supabase signups stay open on the shared instance, so
-- Kortex decides who may use it:
--
-- 1. kortex.allowed_users: the allowlist (service role writes, a user reads only their own row).
--    kortex.is_allowed() is true for the calling user when listed.
-- 2. Every kortex table gets a RESTRICTIVE policy `(select kortex.is_allowed())` on top of its
--    own policies, and the kortex-* storage policies require it too: a signed-up but not
--    allowlisted account can neither read nor write Kortex data, not even through PostgREST.
--    bootstrap_user() refuses such accounts. Service-role daemons (md-sync, MCP) are unaffected.
-- 3. kortex.ai_usage: one row per metered AI call (provider, task, model, tokens, USD estimate),
--    written by the service role only; users read their own rows.
--    kortex.user_settings.daily_ai_budget_eur: daily hard stop (default 2 EUR).
-- Existing Kortex users (with a user_settings row) are seeded as members so nobody is locked out;
-- `pnpm --filter @kortex/db db:allow -- <user_id|email> --role owner` promotes / invites.

-- 1. Allowlist ---------------------------------------------------------------------------------

create table if not exists kortex.allowed_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  note text
);

comment on table kortex.allowed_users is
  'Who may use Kortex (signups on the shared Supabase stay open). Service role writes; users read their own row.';

alter table kortex.allowed_users enable row level security;
revoke all on kortex.allowed_users from authenticated, anon;
grant select on kortex.allowed_users to authenticated;
grant all on kortex.allowed_users to service_role;

drop policy if exists "Users read own allowlist entry" on kortex.allowed_users;
create policy "Users read own allowlist entry" on kortex.allowed_users
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function kortex.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from kortex.allowed_users a where a.user_id = auth.uid());
$$;

revoke all on function kortex.is_allowed() from public, anon;
grant execute on function kortex.is_allowed() to authenticated, service_role;

insert into kortex.allowed_users (user_id, email, role, note)
select s.user_id, u.email, 'member', 'seeded by 20261028000000 (existing Kortex user)'
from kortex.user_settings s
join auth.users u on u.id = s.user_id
on conflict (user_id) do nothing;

-- bootstrap_user(): only allowlisted accounts get a Kortex workspace.
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
  if not exists (select 1 from kortex.allowed_users a where a.user_id = v_uid) then
    raise exception 'kortex: kein Zugang (account not on the Kortex allowlist)'
      using errcode = '42501';
  end if;
  perform kortex._bootstrap_user(v_uid);
end;
$$;

-- 2. Restrictive gate on every kortex table (except the allowlist itself) -----------------------

do $$
declare
  t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kortex' and c.relkind = 'r' and c.relname <> 'allowed_users'
  loop
    execute format('alter table kortex.%I enable row level security', t);
    execute format('drop policy if exists "kortex: allowlisted users only" on kortex.%I', t);
    execute format(
      'create policy "kortex: allowlisted users only" on kortex.%I as restrictive for all to authenticated '
      || 'using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()))',
      t
    );
  end loop;
end $$;

-- Storage: the kortex-* policies (other buckets of the shared instance are untouched).
drop policy if exists "kortex: read own objects" on storage.objects;
create policy "kortex: read own objects" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select kortex.is_allowed())
  );

drop policy if exists "kortex: insert own objects" on storage.objects;
create policy "kortex: insert own objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select kortex.is_allowed())
  );

drop policy if exists "kortex: update own objects" on storage.objects;
create policy "kortex: update own objects" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select kortex.is_allowed())
  )
  with check (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select kortex.is_allowed())
  );

drop policy if exists "kortex: delete own objects" on storage.objects;
create policy "kortex: delete own objects" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('kortex-documents', 'kortex-media', 'kortex-audio')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select kortex.is_allowed())
  );

-- 3. AI usage and daily budget ---------------------------------------------------------------------

create table if not exists kortex.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- calendar day in the user's time zone (the budget window)
  day date not null,
  provider text not null,
  task text not null,
  model_id text,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  -- true when the model had no catalog price and a conservative default was used
  estimated boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_user_day on kortex.ai_usage (user_id, day);

comment on table kortex.ai_usage is
  'Metered AI calls (S2a). Written by the web server with the service role; users read their own rows.';

alter table kortex.ai_usage enable row level security;
revoke all on kortex.ai_usage from authenticated, anon;
grant select on kortex.ai_usage to authenticated;
grant all on kortex.ai_usage to service_role;

drop policy if exists "Users read own ai_usage" on kortex.ai_usage;
create policy "Users read own ai_usage" on kortex.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- the gate loop above ran before this table existed
drop policy if exists "kortex: allowlisted users only" on kortex.ai_usage;
create policy "kortex: allowlisted users only" on kortex.ai_usage as restrictive for all to authenticated
  using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()));

alter table kortex.user_settings
  add column if not exists daily_ai_budget_eur numeric(8, 2) not null default 2;

alter table kortex.user_settings
  drop constraint if exists user_settings_daily_ai_budget_check;
alter table kortex.user_settings
  add constraint user_settings_daily_ai_budget_check check (daily_ai_budget_eur between 0 and 100);

comment on column kortex.user_settings.daily_ai_budget_eur is
  'Daily AI spend limit in EUR (S2a). Metered calls stop with budget_exceeded once kortex.ai_usage for today reaches it.';

notify pgrst, 'reload schema';
