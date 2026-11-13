-- S2b: durable ingest queue. Additive only, schema kortex only.
--
-- POST /api/ingest writes the optimistic item and one row here (service role). A worker inside
-- the web process claims rows with FOR UPDATE SKIP LOCKED (several processes may run), keeps a
-- heartbeat in locked_at while it works, and finishes with done / a retry (run_after in the
-- future, exponential backoff) / error. A process that dies leaves its rows "running" with a
-- stale locked_at; requeue_stale_ingest_jobs() puts them back. Users may read their own jobs;
-- all writes go through the service role.
--
-- The Home briefing cache moved to kortex.user_insights (kind 'briefing', key = day), no table here.

create table if not exists kortex.ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references kortex.knowledge_items (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z_]{0,39}$'),
  -- Pipeline input without file bytes (files are staged in storage, see payload.file).
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 4 check (max_attempts between 1 and 20),
  last_error text check (last_error is null or length(last_error) <= 2000),
  locked_at timestamptz,
  locked_by text check (locked_by is null or length(locked_by) <= 200),
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_ingest_jobs_claim on kortex.ingest_jobs (run_after, created_at) where status = 'queued';
create index if not exists idx_ingest_jobs_running on kortex.ingest_jobs (locked_at) where status = 'running';
create index if not exists idx_ingest_jobs_user_item on kortex.ingest_jobs (user_id, item_id);

create trigger set_ingest_jobs_updated_at before update on kortex.ingest_jobs
  for each row execute function kortex.handle_updated_at();

alter table kortex.ingest_jobs enable row level security;

-- Users read their own jobs (status UI); no client writes.
revoke all on kortex.ingest_jobs from authenticated, anon;
grant select on kortex.ingest_jobs to authenticated;
grant all on kortex.ingest_jobs to service_role;

drop policy if exists "Users read own ingest_jobs" on kortex.ingest_jobs;
create policy "Users read own ingest_jobs" on kortex.ingest_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Claim up to p_limit due jobs for one worker. Concurrent workers never get the same row.
create or replace function kortex.claim_ingest_jobs(p_worker text, p_limit int default 1)
returns setof kortex.ingest_jobs
language sql
set search_path = ''
as $$
  update kortex.ingest_jobs j
     set status = 'running',
         locked_at = now(),
         locked_by = p_worker,
         attempts = j.attempts + 1
   where j.id in (
     select q.id from kortex.ingest_jobs q
      where q.status = 'queued' and q.run_after <= now()
      order by q.run_after, q.created_at
      for update skip locked
      limit greatest(1, least(p_limit, 20))
   )
  returning j.*;
$$;

-- Jobs whose worker stopped sending heartbeats go back to the queue (or fail when out of attempts).
create or replace function kortex.requeue_stale_ingest_jobs(p_stale_seconds int default 60)
returns int
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  update kortex.ingest_jobs
     set status = case when attempts >= max_attempts then 'error' else 'queued' end,
         last_error = coalesce(last_error || ' | ', '') || 'Worker beendet (kein Lebenszeichen)',
         finished_at = case when attempts >= max_attempts then now() else null end,
         locked_at = null,
         locked_by = null,
         run_after = now()
   where status = 'running'
     and locked_at < now() - make_interval(secs => greatest(p_stale_seconds, 10));
  get diagnostics n = row_count;
  return n;
end $$;

-- Graceful shutdown: hand unfinished jobs back without counting the interrupted attempt.
create or replace function kortex.release_ingest_jobs(p_worker text, p_ids uuid[])
returns int
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  update kortex.ingest_jobs
     set status = 'queued',
         attempts = greatest(attempts - 1, 0),
         locked_at = null,
         locked_by = null,
         run_after = now()
   where status = 'running' and locked_by = p_worker and id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function kortex.claim_ingest_jobs(text, int) from public, anon, authenticated;
revoke all on function kortex.requeue_stale_ingest_jobs(int) from public, anon, authenticated;
revoke all on function kortex.release_ingest_jobs(text, uuid[]) from public, anon, authenticated;
grant execute on function kortex.claim_ingest_jobs(text, int) to service_role;
grant execute on function kortex.requeue_stale_ingest_jobs(int) to service_role;
grant execute on function kortex.release_ingest_jobs(text, uuid[]) to service_role;

comment on table kortex.ingest_jobs is
  'Durable ingest queue (S2b). Written by the web server with the service role; users read their own rows.';
