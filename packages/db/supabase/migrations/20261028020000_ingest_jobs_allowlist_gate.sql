-- S2b follow-up: kortex.ingest_jobs gets the S2a allowlist gate (20261028000000 added the
-- restrictive policy to every table that existed then; ingest_jobs came after it).
-- Additive only. The worker uses the service role and is not affected.

drop policy if exists "kortex: allowlisted users only" on kortex.ingest_jobs;
create policy "kortex: allowlisted users only" on kortex.ingest_jobs as restrictive for all to authenticated
  using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()));
