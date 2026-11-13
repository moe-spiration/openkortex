-- Personal API tokens can be deleted by their owner (Settings → Connectors → Persönliche API-Tokens).
-- Additive only, schema kortex only.
--
-- 20261029000000_api_tokens.sql allowed revoke (update of revoked_at) but no delete, so revoked and
-- expired tokens piled up in the list. Now the owner may delete their own rows (any state). A deleted
-- token stops authenticating at once: POST /api/ingest, /api/chat/transcribe and /api/search resolve
-- `Bearer kx_…` by token_hash, and the row (with its hash) is gone. The restrictive allowlist policy
-- "kortex: allowlisted users only" (for all) applies to delete as well.

grant delete on kortex.api_tokens to authenticated;

drop policy if exists "Users delete own api_tokens" on kortex.api_tokens;
create policy "Users delete own api_tokens" on kortex.api_tokens
  for delete to authenticated
  using ((select auth.uid()) = user_id);
