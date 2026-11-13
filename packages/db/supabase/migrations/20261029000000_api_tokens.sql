-- Personal API tokens (browser extension, scripts): one user, many named tokens. Additive only,
-- schema kortex only.
--
-- Token format `kx_<43 chars>`. Only the SHA-256 hex digest is stored (token_hash); the raw token
-- is shown once when it is created. POST /api/ingest resolves `Authorization: Bearer kx_…` with the
-- service role (lookup by hash, last_used_at touched at most once a minute), so a token acts as its
-- owner, exactly like the owner-wide KORTEX_API_TOKEN, but per person and revocable.
--
-- The signed-in user manages their own tokens through server actions that run as the user (RLS):
--   * read: own rows, every column except token_hash (column grant),
--   * create: insert with their own user_id,
--   * revoke: update of revoked_at only.
-- There is no delete: revoked tokens stay as an audit trail until the account is deleted (cascade).

create table if not exists kortex.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- SHA-256 of the raw token, lowercase hex
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- first characters of the raw token, to recognise it in the list ("kx_a1b2c3d4")
  token_prefix text not null check (length(token_prefix) between 4 and 16),
  scopes text[] not null default array['ingest']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_api_tokens_user on kortex.api_tokens (user_id, created_at desc);

alter table kortex.api_tokens enable row level security;

revoke all on kortex.api_tokens from authenticated, anon;
-- token_hash is deliberately not selectable by the client.
grant select (id, user_id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at)
  on kortex.api_tokens to authenticated;
grant insert (user_id, name, token_hash, token_prefix, scopes, expires_at)
  on kortex.api_tokens to authenticated;
grant update (revoked_at) on kortex.api_tokens to authenticated;
grant all on kortex.api_tokens to service_role;

drop policy if exists "Users read own api_tokens" on kortex.api_tokens;
create policy "Users read own api_tokens" on kortex.api_tokens
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own api_tokens" on kortex.api_tokens;
create policy "Users create own api_tokens" on kortex.api_tokens
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users revoke own api_tokens" on kortex.api_tokens;
create policy "Users revoke own api_tokens" on kortex.api_tokens
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- S2a allowlist gate: a signed-in but not allowlisted user cannot manage tokens either.
drop policy if exists "kortex: allowlisted users only" on kortex.api_tokens;
create policy "kortex: allowlisted users only" on kortex.api_tokens as restrictive for all to authenticated
  using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()));

comment on table kortex.api_tokens is 'Personal API tokens (SHA-256 hashed) for /api/ingest and scripts; managed by the owner in Settings.';
