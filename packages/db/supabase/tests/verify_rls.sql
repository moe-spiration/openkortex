-- Kortex schema verification. Runs AFTER the migration inside ONE transaction
-- that the caller rolls back (see packages/db/README.md). Creates two throwaway
-- auth.users rows; nothing persists. Any failed assertion raises and aborts.

-- Structure checks (as postgres) ---------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_extension where extname in ('vector', 'pg_trgm');
  if n <> 2 then raise exception 'FAIL extensions: % of 2', n; end if;

  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'kortex' and c.relkind = 'r' and c.relrowsecurity
    and c.relname in ('folders','tags','knowledge_items','item_highlights','item_chunks','action_items','user_settings','ai_model_catalog','user_insights','sync_status','allowed_users','ai_usage','ingest_jobs');
  if n <> 13 then raise exception 'FAIL rls tables: % of 13', n; end if;

  -- Every kortex table has RLS (no exact count: parallel migrations add tables independently).
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'kortex' and c.relkind = 'r' and not c.relrowsecurity;
  if n <> 0 then raise exception 'FAIL kortex tables without RLS: %', n; end if;

  -- S2a: every kortex table except the allowlist carries the restrictive allowlist gate.
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'kortex' and c.relkind = 'r' and c.relname <> 'allowed_users'
    and not exists (select 1 from pg_policies p where p.schemaname = 'kortex' and p.tablename = c.relname
                    and p.policyname = 'kortex: allowlisted users only' and p.permissive = 'RESTRICTIVE');
  if n <> 0 then raise exception 'FAIL % kortex table(s) without the allowlist gate', n; end if;

  select count(*) into n from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'kortex';
  if n <> 5 then raise exception 'FAIL realtime tables: %', n; end if;

  select count(*) into n from storage.buckets where id like 'kortex-%' and not public;
  if n <> 3 then raise exception 'FAIL buckets: %', n; end if;

  raise notice 'PASS structure: extensions, 13 tables with RLS + allowlist gate, realtime, 3 private buckets';
end $$;

-- Two fake users (rolled back with the transaction)
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'kortex-test-a@example.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'kortex-test-b@example.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'kortex-test-c@example.invalid', now(), now());

-- A and B are on the Kortex allowlist, C only signed up (S2a).
insert into kortex.allowed_users (user_id, email, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'kortex-test-a@example.invalid', 'member'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'kortex-test-b@example.invalid', 'member');

-- No signup trigger: Kortex rows must not exist yet
do $$
begin
  if exists (select 1 from kortex.user_settings where user_id in
      ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')) or exists (select 1 from kortex.folders where user_id in
      ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')) then
    raise exception 'FAIL: kortex rows created on signup';
  end if;
  raise notice 'PASS no kortex rows on signup';
end $$;

-- anon gets nothing ------------------------------------------------------------
set local role anon;
do $$
begin
  begin
    perform 1 from kortex.knowledge_items;
    raise exception 'FAIL anon can read kortex.knowledge_items';
  exception when insufficient_privilege then
    raise notice 'PASS anon has no access';
  end;
end $$;
reset role;

-- User A ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

select kortex.bootstrap_user();
select kortex.bootstrap_user(); -- idempotent

do $$
declare n int; v_item uuid;
begin
  select count(*) into n from kortex.folders where is_system_default;
  if n <> 26 then raise exception 'FAIL A folders: %', n; end if;
  select count(*) into n from kortex.folders f
    join kortex.folders p on p.id = f.parent_id
    where f.folder_path = p.folder_path || '/' || f.name;
  if n <> 17 then raise exception 'FAIL A child folders with correct parent/path: %', n; end if;
  select count(*) into n from kortex.user_settings;
  if n <> 1 then raise exception 'FAIL A settings: %', n; end if;

  insert into kortex.knowledge_items (user_id, title, slug, summary, content_md, type, folder_path, tags)
  values (auth.uid(), 'Hybrid search with pgvector', 'hybrid-search', 'RRF fusion of vector and FTS',
          'Kortex combines pgvector embeddings with weighted full text search.', 'note', '10_Notes', '{ai/search}')
  returning id into v_item;
  insert into kortex.knowledge_items (user_id, title, slug, type, folder_path, metadata)
  values (auth.uid(), 'Ada Lovelace', 'ada-lovelace', 'person', '70_Objects/People', '{"role":"Mathematician"}');

  insert into kortex.item_chunks (item_id, user_id, chunk_index, chunk_text, embedding, metadata)
  values (v_item, auth.uid(), 0, 'pgvector embeddings chunk',
          array_fill(0.01::real, array[1536])::extensions.vector,
          '{"embedding_model":"openrouter:test/embed-a"}');
  insert into kortex.item_highlights (item_id, user_id, quote_text) values (v_item, auth.uid(), 'weighted full text');
  insert into kortex.action_items (user_id, source_item_id, title) values (auth.uid(), v_item, 'Tune rrf_k');
  insert into kortex.tags (user_id, name) values (auth.uid(), 'ai/search');
  insert into kortex.user_insights (user_id, kind, key, payload) values (auth.uid(), 'life_vision', 'health', '{"text":"fit"}');
  -- ingest_jobs: users read, only the service role writes or claims
  begin
    insert into kortex.ingest_jobs (user_id, kind) values (auth.uid(), 'note');
    raise exception 'FAIL A could insert ingest_jobs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform kortex.claim_ingest_jobs('test', 1);
    raise exception 'FAIL A could claim ingest_jobs';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from kortex.ingest_jobs;
  if n <> 0 then raise exception 'FAIL A sees % ingest_jobs', n; end if;

  -- hybrid search: both sides, FTS only, vector only, folder filter
  select count(*) into n from kortex.match_knowledge_hybrid('pgvector search',
    array_fill(0.01::real, array[1536])::extensions.vector, 10);
  if n <> 1 then raise exception 'FAIL A hybrid (both): % rows', n; end if;
  select count(*) into n from kortex.match_knowledge_hybrid('lovelace', null, 10);
  if n <> 1 then raise exception 'FAIL A hybrid (fts only): % rows', n; end if;
  select count(*) into n from kortex.match_knowledge_hybrid(null,
    array_fill(0.01::real, array[1536])::extensions.vector, 10);
  if n <> 1 then raise exception 'FAIL A hybrid (vector only): % rows', n; end if;
  select count(*) into n from kortex.match_knowledge_hybrid('lovelace', null, 10, null, '70_Objects');
  if n <> 1 then raise exception 'FAIL A hybrid (folder filter): % rows', n; end if;
  select count(*) into n from kortex.match_knowledge_hybrid('lovelace', null, 10, null, '70_Obj');
  if n <> 0 then raise exception 'FAIL A hybrid (partial folder prefix must not match): % rows', n; end if;
  -- embedding model filter: same model matches, another model's query only sees FTS
  select count(*) into n from kortex.match_knowledge_hybrid(null,
    array_fill(0.01::real, array[1536])::extensions.vector, 10, filter_embedding_model => 'openrouter:test/embed-a');
  if n <> 1 then raise exception 'FAIL A hybrid (same embedding model): % rows', n; end if;
  select count(*) into n from kortex.match_knowledge_hybrid(null,
    array_fill(0.01::real, array[1536])::extensions.vector, 10, filter_embedding_model => 'openrouter:other/model');
  if n <> 0 then raise exception 'FAIL A hybrid (other embedding model must not match): % rows', n; end if;
  -- service-role variant is not callable as a user
  begin
    perform kortex.match_knowledge_hybrid_for_user(auth.uid(), 'lovelace', null, 10);
    raise exception 'FAIL authenticated can call match_knowledge_hybrid_for_user';
  exception when insufficient_privilege then null;
  end;
  -- embedding lock: own row, only valid shapes
  update kortex.user_settings set embedding_lock =
    '{"provider":"openrouter","model_id":"test/embed-a","dimensions":1536,"locked_at":"2026-10-25T00:00:00Z"}'
    where user_id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL A cannot set own embedding_lock'; end if;
  begin
    update kortex.user_settings set embedding_lock = '{"provider":"openrouter","model_id":"x","dimensions":768}'
      where user_id = auth.uid();
    raise exception 'FAIL embedding_lock accepted 768 dims';
  exception when check_violation then null;
  end;

  -- storage: own prefix ok, foreign prefix denied
  insert into storage.objects (bucket_id, name, owner_id)
  values ('kortex-documents', 'aaaaaaaa-0000-4000-8000-000000000001/book.pdf', auth.uid()::text);
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('kortex-documents', 'bbbbbbbb-0000-4000-8000-000000000002/evil.pdf', auth.uid()::text);
    raise exception 'FAIL A wrote into B storage prefix';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS user A: bootstrap 26 folders + settings (idempotent), inserts, hybrid search, storage prefix';
end $$;

-- ADR-06 routing + model catalog (still user A) ---------------------------------
do $$
declare n int; v_cfg jsonb;
begin
  select ai_routing_config into v_cfg from kortex.user_settings;
  if v_cfg -> 'summarize' ->> 'provider' <> 'anthropic'
     or v_cfg -> 'chat_reasoning' ->> 'auto_mode' <> 'max_quality'
     or v_cfg -> 'audio_transcription' ->> 'provider' <> 'edenai'
     or v_cfg -> 'embeddings' ->> 'dimensions' <> '1536' then
    raise exception 'FAIL A routing defaults: %', v_cfg;
  end if;

  update kortex.user_settings
    set ai_routing_config = jsonb_set(ai_routing_config, '{chat_reasoning,model_id}', '"claude-sonnet-4-5"');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL A cannot update own routing'; end if;

  begin
    update kortex.user_settings
      set ai_routing_config = jsonb_set(ai_routing_config, '{embeddings,dimensions}', '3072');
    raise exception 'FAIL embeddings route accepted 3072 dimensions';
  exception when check_violation then null;
  end;

  perform 1 from kortex.ai_model_catalog limit 1;
  begin
    insert into kortex.ai_model_catalog (provider, model_id) values ('openrouter', 'forged/model');
    raise exception 'FAIL authenticated wrote the model catalog';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS ADR-06: routing defaults, own update, 1536-dim guard, catalog read-only';
end $$;

-- User B ----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
select kortex.bootstrap_user();

do $$
declare n int; v_a_item uuid;
begin
  select count(*) into n from kortex.folders;
  if n <> 26 then raise exception 'FAIL B sees % folders (expected own 26)', n; end if;
  select count(*) into n from kortex.user_settings;
  if n <> 1 then raise exception 'FAIL B sees % settings rows', n; end if;
  select count(*) into n from kortex.knowledge_items;
  if n <> 0 then raise exception 'FAIL B can read A items: %', n; end if;
  select count(*) into n from kortex.item_chunks;
  if n <> 0 then raise exception 'FAIL B can read A chunks'; end if;
  select count(*) into n from kortex.item_highlights;
  if n <> 0 then raise exception 'FAIL B can read A highlights'; end if;
  select count(*) into n from kortex.action_items;
  if n <> 0 then raise exception 'FAIL B can read A action items'; end if;
  select count(*) into n from kortex.tags;
  if n <> 0 then raise exception 'FAIL B can read A tags'; end if;
  select count(*) into n from kortex.user_insights;
  if n <> 0 then raise exception 'FAIL B can read A user_insights'; end if;
  update kortex.user_insights set payload = '{}' where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B updated A user_insights'; end if;
  select count(*) into n from storage.objects where bucket_id like 'kortex-%';
  if n <> 0 then raise exception 'FAIL B can list A storage objects'; end if;
  select count(*) into n from kortex.match_knowledge_hybrid('pgvector lovelace',
    array_fill(0.01::real, array[1536])::extensions.vector, 10);
  if n <> 0 then raise exception 'FAIL B hybrid search leaks % rows', n; end if;
  select count(*) into n from kortex._match_knowledge_hybrid('aaaaaaaa-0000-4000-8000-000000000001',
    'pgvector lovelace', array_fill(0.01::real, array[1536])::extensions.vector, 10);
  if n <> 0 then raise exception 'FAIL B reads A via _match_knowledge_hybrid: % rows', n; end if;

  -- write attempts against A
  update kortex.knowledge_items set title = 'pwned' where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B updated A items'; end if;
  delete from kortex.folders where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B deleted A folders'; end if;

  begin
    insert into kortex.knowledge_items (user_id, title, slug)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'forged', 'forged');
    raise exception 'FAIL B inserted row owned by A';
  exception when insufficient_privilege then null;
  end;

  -- attach a chunk to A's item under B's own user_id
  reset role;
  select id into v_a_item from kortex.knowledge_items where slug = 'hybrid-search';
  set local role authenticated;
  begin
    insert into kortex.item_chunks (item_id, user_id, chunk_index, chunk_text)
    values (v_a_item, auth.uid(), 1, 'foreign');
    raise exception 'FAIL B attached chunk to A item';
  exception when insufficient_privilege then null;
  end;

  begin
    perform kortex._bootstrap_user('aaaaaaaa-0000-4000-8000-000000000001');
    raise exception 'FAIL authenticated can call _bootstrap_user';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS user B: isolated from A (read, update, delete, forged insert, foreign chunk, storage, search)';
end $$;

reset role;

-- WP-M: sync_status (daemon heartbeat) and the new user_settings columns ----------------------
-- The CLI daemon writes heartbeats with the service role; since 0.6.0 the desktop sidecar writes
-- them as the user (20261103100000_sync_status_user_writes.sql). Owners read, insert and update
-- their OWN rows only; another user can neither read nor write them.
set local role service_role;
insert into kortex.sync_status (user_id, device_id, vault_path, daemon_version, last_success_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'test-pc.vault-a', 'C:/Vault', '0.0.0', now());
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare n int; v_habits jsonb; v_locale text;
begin
  select count(*) into n from kortex.sync_status;
  if n <> 1 then raise exception 'FAIL A sees own sync_status: %', n; end if;

  update kortex.sync_status set sync_requested_at = now() where device_id = 'test-pc.vault-a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL A cannot request a sync: %', n; end if;

  -- Desktop sidecar (token mode): its own heartbeat, as the user.
  update kortex.sync_status set vault_path = 'C:/elsewhere', last_heartbeat_at = now() where device_id = 'test-pc.vault-a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL A cannot update own heartbeat: %', n; end if;

  insert into kortex.sync_status (user_id, device_id, vault_path, daemon_version)
  values (auth.uid(), 'test-pc.vault-a2', 'D:/Vault', '0.6.0')
  on conflict (user_id, device_id) do update set vault_path = excluded.vault_path, last_heartbeat_at = now();
  insert into kortex.sync_status (user_id, device_id, vault_path, daemon_version)
  values (auth.uid(), 'test-pc.vault-a2', 'D:/Vault2', '0.6.0')
  on conflict (user_id, device_id) do update set vault_path = excluded.vault_path, last_heartbeat_at = now();
  select count(*) into n from kortex.sync_status where device_id = 'test-pc.vault-a2' and vault_path = 'D:/Vault2';
  if n <> 1 then raise exception 'FAIL A cannot upsert own heartbeat: %', n; end if;

  -- Never a row in someone else's name.
  begin
    insert into kortex.sync_status (user_id, device_id) values ('bbbbbbbb-0000-4000-8000-000000000002', 'forged');
    raise exception 'FAIL A can insert a heartbeat for B';
  exception when insufficient_privilege then null;
  end;
  begin
    update kortex.sync_status set user_id = 'bbbbbbbb-0000-4000-8000-000000000002' where device_id = 'test-pc.vault-a2';
    raise exception 'FAIL A can hand a heartbeat to B';
  exception when insufficient_privilege then null;
  end;

  select habits, locale into v_habits, v_locale from kortex.user_settings where user_id = auth.uid();
  -- New accounts start in English (20261111000000); the user switches to German below.
  if v_locale <> 'en' or jsonb_array_length(v_habits) <> 2 then
    raise exception 'FAIL user_settings defaults: locale %, habits %', v_locale, v_habits;
  end if;
  update kortex.user_settings set locale = 'de', habits = '[{"key":"run","label":"Laufen"}]'::jsonb where user_id = auth.uid();
  begin
    update kortex.user_settings set locale = 'xx' where user_id = auth.uid();
    raise exception 'FAIL locale check';
  exception when check_violation then null;
  end;
  raise notice 'PASS user A: own sync_status read, sync request, own heartbeat insert/update/upsert, none for B; locale/habits defaults and checks';
end $$;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from kortex.sync_status;
  if n <> 0 then raise exception 'FAIL B sees A sync_status: %', n; end if;
  update kortex.sync_status set sync_requested_at = now();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B requested a sync for A: %', n; end if;
  update kortex.sync_status set vault_path = 'C:/hijack', last_heartbeat_at = now();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B rewrote A heartbeat: %', n; end if;
  begin
    delete from kortex.sync_status;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL B deleted A heartbeat: %', n; end if;
  exception when insufficient_privilege then null; -- no delete grant at all
  end;
  begin
    insert into kortex.sync_status (user_id, device_id) values ('aaaaaaaa-0000-4000-8000-000000000001', 'forged-b');
    raise exception 'FAIL B can insert a heartbeat for A';
  exception when insufficient_privilege then null;
  end;
  -- An upsert on A's key must not touch A's row (B cannot see it, so it conflicts invisibly or fails).
  begin
    insert into kortex.sync_status (user_id, device_id, vault_path) values ('aaaaaaaa-0000-4000-8000-000000000001', 'test-pc.vault-a', 'C:/hijack')
    on conflict (user_id, device_id) do update set vault_path = excluded.vault_path;
    raise exception 'FAIL B can upsert over A heartbeat';
  exception when insufficient_privilege then null;
  end;
  -- B's own heartbeat works.
  insert into kortex.sync_status (user_id, device_id) values (auth.uid(), 'test-pc.vault-b');
  select count(*) into n from kortex.sync_status;
  if n <> 1 then raise exception 'FAIL B sees exactly its own heartbeat: %', n; end if;
  raise notice 'PASS user B: no access to A sync_status (read, update, delete, insert, upsert), own heartbeat ok';
end $$;
reset role;

-- Service role: explicit user scope for md-sync / MCP without a JWT
set local role service_role;
do $$
declare n int;
begin
  select count(*) into n from kortex.match_knowledge_hybrid_for_user('aaaaaaaa-0000-4000-8000-000000000001',
    'pgvector', array_fill(0.01::real, array[1536])::extensions.vector, 10,
    filter_embedding_model => 'openrouter:test/embed-a');
  if n <> 1 then raise exception 'FAIL service hybrid for A: % rows', n; end if;
  select count(*) into n from kortex.match_knowledge_hybrid_for_user('bbbbbbbb-0000-4000-8000-000000000002',
    'pgvector', array_fill(0.01::real, array[1536])::extensions.vector, 10);
  if n <> 0 then raise exception 'FAIL service hybrid for B sees A: % rows', n; end if;
  raise notice 'PASS service-role hybrid search scoped by user and embedding model';
end $$;
reset role;

-- S2a: allowlist gate, AI usage and budget --------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
declare n int;
begin
  if kortex.is_allowed() then raise exception 'FAIL C counts as allowed'; end if;
  begin
    perform kortex.bootstrap_user();
    raise exception 'FAIL C (not allowlisted) could bootstrap';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into kortex.knowledge_items (user_id, title, slug) values (auth.uid(), 'sneaky', 'sneaky');
    raise exception 'FAIL C wrote knowledge_items through PostgREST';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into kortex.user_settings (user_id) values (auth.uid());
    raise exception 'FAIL C created its own user_settings row';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from kortex.ai_model_catalog;
  if n <> 0 then raise exception 'FAIL C reads the model catalog'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('kortex-documents', 'cccccccc-0000-4000-8000-000000000003/x.pdf', auth.uid()::text);
    raise exception 'FAIL C uploaded into kortex-documents';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from kortex.allowed_users;
  if n <> 0 then raise exception 'FAIL C sees allowlist rows: %', n; end if;
  raise notice 'PASS not allowlisted: no bootstrap, no table/storage writes, no reads';
end $$;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare n int; v numeric;
begin
  if not kortex.is_allowed() then raise exception 'FAIL A not allowed'; end if;
  select count(*) into n from kortex.allowed_users;
  if n <> 1 then raise exception 'FAIL A sees % allowlist rows (expected own)', n; end if;
  begin
    insert into kortex.allowed_users (user_id, role) values ('cccccccc-0000-4000-8000-000000000003', 'owner');
    raise exception 'FAIL A invited C directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into kortex.ai_usage (user_id, day, provider, task, cost_usd) values (auth.uid(), current_date, 'x', 'summarize', 0);
    raise exception 'FAIL A wrote ai_usage directly';
  exception when insufficient_privilege then null;
  end;
  select daily_ai_budget_eur into v from kortex.user_settings;
  if v <> 2 then raise exception 'FAIL default budget %', v; end if;
  begin
    update kortex.user_settings set daily_ai_budget_eur = 1000;
    raise exception 'FAIL budget above 100 accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS allowlisted A: own allowlist row only, no direct usage/allowlist writes, budget default 2 EUR';
end $$;
reset role;

set local role service_role;
do $$
declare n int;
begin
  insert into kortex.ai_usage (user_id, day, provider, task, model_id, input_tokens, output_tokens, cost_usd)
  values ('aaaaaaaa-0000-4000-8000-000000000001', current_date, 'anthropic', 'summarize', 'm', 100, 50, 0.001);
  begin
    insert into kortex.ai_usage (user_id, day, provider, task, cost_usd)
    values ('aaaaaaaa-0000-4000-8000-000000000001', current_date, 'anthropic', 'summarize', -1);
    raise exception 'FAIL negative cost accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS service role records usage (non-negative)';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from kortex.ai_usage;
  if n <> 0 then raise exception 'FAIL B reads A usage'; end if;
  raise notice 'PASS usage rows are private';
end $$;
reset role;

-- Personal API tokens: the owner creates and revokes, never reads the hash; others see nothing.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare n int;
begin
  insert into kortex.api_tokens (user_id, name, token_hash, token_prefix)
  values (auth.uid(), 'Chrome', repeat('a', 64), 'kx_abcd1234');
  begin
    insert into kortex.api_tokens (user_id, name, token_hash, token_prefix)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'foreign', repeat('b', 64), 'kx_foreign0');
    raise exception 'FAIL A created a token for B';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    perform token_hash from kortex.api_tokens;
    raise exception 'FAIL A could read token_hash';
  exception when insufficient_privilege then null;
  end;
  update kortex.api_tokens set revoked_at = now() where name = 'Chrome';
  select count(*) into n from kortex.api_tokens where revoked_at is not null;
  if n <> 1 then raise exception 'FAIL A could not revoke own token: %', n; end if;
  begin
    update kortex.api_tokens set name = 'renamed';
    raise exception 'FAIL A could update columns other than revoked_at';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS owner creates and revokes tokens, hash stays server-side';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from kortex.api_tokens;
  if n <> 0 then raise exception 'FAIL B sees A tokens'; end if;
  update kortex.api_tokens set revoked_at = now();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B revoked A tokens'; end if;
  delete from kortex.api_tokens;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B deleted A tokens'; end if;
  raise notice 'PASS tokens are private';
end $$;
reset role;

-- The owner may delete own tokens (20261101200000_api_tokens_delete).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare n int;
begin
  delete from kortex.api_tokens where name = 'Chrome';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL A could not delete own token: %', n; end if;
  raise notice 'PASS owner deletes own tokens';
end $$;
reset role;

select 'ALL CHECKS PASSED' as result;
