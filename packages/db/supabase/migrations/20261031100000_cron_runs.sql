-- N4: server cron runs (weekly digest first). Additive only, schema kortex only.
--
-- POST /api/cron/digest runs hourly (Coolify scheduled task). For every allowlisted user whose
-- weekly_digest_day has come it claims one row per (user, job, period): the primary key makes the
-- claim atomic, so overlapping cron calls or several web processes never generate a week twice.
-- A failed run keeps its row (status 'error', attempts) and is retried a few times later.
-- Service role only: users never read or write these rows.

create table if not exists kortex.cron_runs (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'weekly_digest'
  job text not null check (job ~ '^[a-z_]{1,40}$'),
  -- ISO week of the run, e.g. '2026-W44'
  period text not null check (length(period) between 1 and 40),
  status text not null default 'running' check (status in ('running', 'done', 'error', 'skipped')),
  attempts int not null default 1 check (attempts between 1 and 100),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb,
  error text check (error is null or length(error) <= 2000),
  primary key (user_id, job, period)
);

create index if not exists idx_cron_runs_job_period on kortex.cron_runs (job, period);

comment on table kortex.cron_runs is
  'One row per user, cron job and period (claim + outcome). Written by POST /api/cron/* with the service role.';

alter table kortex.cron_runs enable row level security;
revoke all on kortex.cron_runs from authenticated, anon;
grant all on kortex.cron_runs to service_role;

drop policy if exists "kortex: allowlisted users only" on kortex.cron_runs;
create policy "kortex: allowlisted users only" on kortex.cron_runs as restrictive for all to authenticated
  using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()));
