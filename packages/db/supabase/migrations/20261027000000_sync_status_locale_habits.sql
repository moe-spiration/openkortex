-- WP-M: the last live-mode mocks of the web app.
-- Additive only, schema kortex only.
--
-- 1. kortex.sync_status: heartbeat of the local md-sync daemon, one row per user and device.
--    The web server can't see the local vault, so the daemon reports its vault path, last sync,
--    pending work and version here (service role, bypasses RLS). The signed-in user reads their
--    rows and may only set sync_requested_at ("Sync" button); the daemon picks that up via
--    Realtime (or its next heartbeat), runs a full reconcile and writes sync_handled_at.
-- 2. user_settings.locale: UI / AI answer language (default 'de').
-- 3. user_settings.habits: the user's daily check-in habits [{ key, label }] (default: the two
--    habits every user had before). Done-state stays in the daily note (metadata.checkin).

-- 1. sync_status ------------------------------------------------------------------------------
create table if not exists kortex.sync_status (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null check (device_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  device_name text check (device_name is null or length(device_name) <= 120),
  vault_path text check (vault_path is null or length(vault_path) <= 1000),
  daemon_version text check (daemon_version is null or length(daemon_version) <= 40),
  state text not null default 'running' check (state in ('running', 'stopped', 'error')),
  realtime text check (realtime is null or realtime in ('connected', 'disconnected')),
  last_heartbeat_at timestamptz not null default now(),
  -- last push or pull of a file
  last_sync_at timestamptz,
  -- last full reconcile without errors
  last_success_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 1000),
  last_error_at timestamptz,
  pending_local integer not null default 0 check (pending_local >= 0),
  pending_ingest integer not null default 0 check (pending_ingest >= 0),
  items_tracked integer check (items_tracked is null or items_tracked >= 0),
  stats jsonb not null default '{}'::jsonb,
  sync_requested_at timestamptz,
  sync_handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists sync_status_user_heartbeat_idx
  on kortex.sync_status (user_id, last_heartbeat_at desc);

drop trigger if exists set_sync_status_updated_at on kortex.sync_status;
create trigger set_sync_status_updated_at before update on kortex.sync_status
  for each row execute function kortex.handle_updated_at();

alter table kortex.sync_status enable row level security;

-- Owner reads all columns and may only request a sync; the daemon writes with the service role.
revoke all on kortex.sync_status from authenticated;
grant select on kortex.sync_status to authenticated;
grant update (sync_requested_at) on kortex.sync_status to authenticated;
grant all on kortex.sync_status to service_role;

drop policy if exists "Users read own sync_status" on kortex.sync_status;
create policy "Users read own sync_status" on kortex.sync_status
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users request own sync" on kortex.sync_status;
create policy "Users request own sync" on kortex.sync_status
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'kortex' and tablename = 'sync_status'
  ) then
    alter publication supabase_realtime add table kortex.sync_status;
  end if;
end $$;

comment on table kortex.sync_status is
  'Heartbeat of the local md-sync daemon per user and device (vault path, last sync, pending work). Written by the daemon (service role); the owner reads it and may set sync_requested_at.';
comment on column kortex.sync_status.sync_requested_at is
  'Set by the web app ("Sync" button). The daemon runs a full reconcile when it is newer than sync_handled_at.';

-- 2. + 3. user_settings ---------------------------------------------------------------------
alter table kortex.user_settings
  add column if not exists locale text not null default 'de',
  add column if not exists habits jsonb not null
    default '[{"key": "mob", "label": "Morning Mobility"}, {"key": "carb", "label": "Low-Carb Fokus"}]'::jsonb;

alter table kortex.user_settings drop constraint if exists user_settings_locale_check;
alter table kortex.user_settings
  add constraint user_settings_locale_check check (locale in ('de', 'en'));

alter table kortex.user_settings drop constraint if exists user_settings_habits_check;
alter table kortex.user_settings
  add constraint user_settings_habits_check check (
    jsonb_typeof(habits) = 'array' and jsonb_array_length(habits) <= 12
  );

comment on column kortex.user_settings.locale is 'UI and AI answer language (de, en). Default de.';
comment on column kortex.user_settings.habits is
  'Daily check-in habits [{ key, label }] in display order (max 12). Done-state lives in the daily note.';

-- PostgREST: pick up the new table and columns.
notify pgrst, 'reload schema';
