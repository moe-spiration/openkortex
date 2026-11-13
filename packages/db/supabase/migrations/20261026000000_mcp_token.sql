-- WP-B2: per-user bearer token for the MCP HTTP transport, managed from the web settings.
-- Additive only, schema kortex only (public.user_settings belongs to another app).
--
-- The web app generates the token server-side (32 random bytes, base64url) and shows it to the
-- user exactly once. Only its SHA-256 hash (hex) is stored, plus the last 4 characters as a hint
-- for the UI ("••••abcd") and the creation time. Revoking sets all three back to null.
-- The MCP server verifies a presented token by hashing it and comparing against mcp_token_hash
-- (constant-time), looked up with the service role.

alter table kortex.user_settings
  add column if not exists mcp_token_hash text,
  add column if not exists mcp_token_hint text,
  add column if not exists mcp_token_created_at timestamptz;

alter table kortex.user_settings
  drop constraint if exists user_settings_mcp_token_check;
alter table kortex.user_settings
  add constraint user_settings_mcp_token_check check (
    (mcp_token_hash is null and mcp_token_hint is null and mcp_token_created_at is null)
    or (
      mcp_token_hash ~ '^[0-9a-f]{64}$'
      and coalesce(length(mcp_token_hint), 0) between 1 and 8
      and mcp_token_created_at is not null
    )
  );

-- Token lookup by hash (MCP server, service role). Partial: most rows have no token.
create unique index if not exists user_settings_mcp_token_hash_key
  on kortex.user_settings (mcp_token_hash)
  where mcp_token_hash is not null;

comment on column kortex.user_settings.mcp_token_hash is
  'SHA-256 (hex) of the MCP HTTP bearer token. The token itself is never stored; it is shown once on creation.';
comment on column kortex.user_settings.mcp_token_hint is
  'Last 4 characters of the MCP bearer token, for display only.';
comment on column kortex.user_settings.mcp_token_created_at is
  'When the current MCP bearer token was created (null = no token).';
