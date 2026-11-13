-- Connections to outside tools the user signs in to (first: Griply, the task tool, over its remote
-- MCP server with OAuth). Additive only, schema kortex only.
--
-- One row per user and provider. The web app server runs the OAuth sign-in and keeps the client
-- registration, the PKCE verifier and the tokens in `secrets`. The browser never sees them:
--   * the signed-in user may read the plain columns of their own row and delete the row (disconnect),
--   * `secrets` has no column grant for authenticated, every write goes through the service role
--     (the server checks the session first and always filters user_id).

create table if not exists kortex.external_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('griply')),
  server_url text not null check (server_url ~ '^https://'),
  -- pending: sign-in started, waiting for the callback; connected: tokens stored
  status text not null default 'pending' check (status in ('pending', 'connected')),
  -- what the user allowed in the tool: read, or read and change; null until known
  access text check (access in ('read', 'write')),
  secrets jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table kortex.external_connections enable row level security;

revoke all on kortex.external_connections from authenticated, anon;
-- secrets is deliberately not selectable by the client.
grant select (user_id, provider, server_url, status, access, connected_at, created_at, updated_at)
  on kortex.external_connections to authenticated;
grant delete on kortex.external_connections to authenticated;
grant all on kortex.external_connections to service_role;

drop policy if exists "Users read own external_connections" on kortex.external_connections;
create policy "Users read own external_connections" on kortex.external_connections
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users delete own external_connections" on kortex.external_connections;
create policy "Users delete own external_connections" on kortex.external_connections
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "kortex: allowlisted users only" on kortex.external_connections;
create policy "kortex: allowlisted users only" on kortex.external_connections as restrictive for all to authenticated
  using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()));

comment on table kortex.external_connections is
  'Sign-ins to outside tools (Griply over MCP with OAuth). Tokens live in secrets, readable by the service role only.';

notify pgrst, 'reload schema';
