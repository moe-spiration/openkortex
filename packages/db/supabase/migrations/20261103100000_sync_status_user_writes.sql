-- Fix round 0.6.0 (D vault-sync): md-sync runs on the user's PC as the desktop sidecar, on the
-- user's own token (POST /api/sync/session mints a user JWT), never with the service role.
-- Its heartbeat therefore writes kortex.sync_status as the signed-in user. Additive only.
--
-- Until now the owner could only read their rows and set sync_requested_at. Now they may insert and
-- update their own rows (the daemon's upsert on (user_id, device_id)). Faking one's own heartbeat
-- shows wrong status to oneself only; RLS keeps every other user's rows out of reach, and the
-- restrictive allowlist policy from 20261028000000 still applies.

grant insert, update on kortex.sync_status to authenticated;

drop policy if exists "Users write own sync_status" on kortex.sync_status;
create policy "Users write own sync_status" on kortex.sync_status
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- "Users request own sync" (for update, using + with check on auth.uid() = user_id) already
-- covers updates of the owner's rows; with the wider column grant it now covers the daemon's beat.

comment on table kortex.sync_status is
  'Heartbeat of the md-sync daemon per user and device (vault path, last sync, pending work). Written by the daemon: desktop sidecar as the user (RLS) or CLI with the service role. The owner reads it and sets sync_requested_at from the web app.';
