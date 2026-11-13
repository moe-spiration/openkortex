-- md-sync and the MCP server rebuild their AI router when routing or the embedding lock change
-- (Realtime on the user's own row). Additive: only adds the table to the publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'kortex' and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table kortex.user_settings;
  end if;
end $$;
