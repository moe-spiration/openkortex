-- Agent jobs ("Aufträge") and standing orders ("Daueraufträge"). Additive only, schema kortex only.
--
-- A job is one piece of work the agent does in the background: the request, how much it may do
-- (autonomy), and afterwards the outcome (answer, steps, sources, proposed or finished changes).
--   queued    waiting to start
--   running   the agent is working
--   waiting   finished with changes that wait for the user's confirmation
--   done      finished (answer only, or changes confirmed or carried out)
--   error     failed (reason in `error`)
--   cancelled dismissed by the user
-- A standing order starts a job on a schedule (daily at an hour, or weekly on a weekday at an hour,
-- in the server's time zone KORTEX_TIMEZONE). `last_period` is the claim: one run per day or week.
--
-- Rows belong to their user (RLS). The web app writes them as the signed-in user; the hourly cron
-- (standing orders) uses the service role and filters user_id.

create table if not exists kortex.agent_standing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  prompt text not null check (length(btrim(prompt)) between 1 and 4000),
  skill text check (skill in ('briefing', 'research', 'tidy', 'draft', 'week', 'dossier')),
  autonomy text not null default 'ask' check (autonomy in ('read', 'ask', 'self')),
  cadence text not null check (cadence in ('daily', 'weekly')),
  hour int not null check (hour between 0 and 23),
  -- ISO weekday 1 (Monday) to 7 (Sunday); only for weekly
  weekday int check (weekday between 1 and 7),
  enabled boolean not null default true,
  -- '2026-11-12' (daily) or '2026-W46' (weekly) of the last started run
  last_period text check (last_period is null or length(last_period) <= 20),
  created_at timestamptz not null default now(),
  check ((cadence = 'weekly') = (weekday is not null))
);

create index if not exists idx_agent_standing_orders_user on kortex.agent_standing_orders (user_id, created_at);

create table if not exists kortex.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  prompt text not null check (length(btrim(prompt)) between 1 and 4000),
  skill text check (skill in ('briefing', 'research', 'tidy', 'draft', 'week', 'dossier')),
  autonomy text not null default 'ask' check (autonomy in ('read', 'ask', 'self')),
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'done', 'error', 'cancelled')),
  -- manual: typed by the user; standing: started by a standing order; task: a task handed to the
  -- agent; presort: the daily stack looked through
  origin text not null default 'manual' check (origin in ('manual', 'standing', 'task', 'presort')),
  standing_order_id uuid references kortex.agent_standing_orders (id) on delete set null,
  action_item_id uuid references kortex.action_items (id) on delete set null,
  -- { answer_md, steps[], sources[], proposal { actions[], labels[] }, done { results[] }, undone }
  result jsonb,
  error text check (error is null or length(error) <= 2000),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_agent_jobs_user_created on kortex.agent_jobs (user_id, created_at desc);
create index if not exists idx_agent_jobs_action_item on kortex.agent_jobs (action_item_id) where action_item_id is not null;

alter table kortex.agent_standing_orders enable row level security;
revoke all on kortex.agent_standing_orders from anon;
grant select, insert, update, delete on kortex.agent_standing_orders to authenticated;
grant all on kortex.agent_standing_orders to service_role;

drop policy if exists "Users manage own agent_standing_orders" on kortex.agent_standing_orders;
create policy "Users manage own agent_standing_orders" on kortex.agent_standing_orders for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "kortex: allowlisted users only" on kortex.agent_standing_orders;
create policy "kortex: allowlisted users only" on kortex.agent_standing_orders as restrictive for all to authenticated
  using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()));

alter table kortex.agent_jobs enable row level security;
revoke all on kortex.agent_jobs from anon;
grant select, insert, update, delete on kortex.agent_jobs to authenticated;
grant all on kortex.agent_jobs to service_role;

drop policy if exists "Users manage own agent_jobs" on kortex.agent_jobs;
create policy "Users manage own agent_jobs" on kortex.agent_jobs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "kortex: allowlisted users only" on kortex.agent_jobs;
create policy "kortex: allowlisted users only" on kortex.agent_jobs as restrictive for all to authenticated
  using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()));

comment on table kortex.agent_jobs is 'Background work of the agent: request, state and outcome (answer, steps, proposed or finished changes).';
comment on table kortex.agent_standing_orders is 'Standing orders: start an agent job daily or weekly at an hour.';

notify pgrst, 'reload schema';
