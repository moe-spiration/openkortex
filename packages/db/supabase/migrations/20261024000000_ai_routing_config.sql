-- ADR-06: Multi-Provider AI Gateway & Task-Based Model Routing.
-- Additive only, schema kortex only (public.user_settings belongs to another app).
--
-- 1. kortex.user_settings.ai_routing_config: one route per AI task
--      { "<task>": { "provider": "anthropic"|"openrouter"|"edenai",
--                    "model_id": string|null,            -- null = Auto
--                    "auto_mode": "cost_efficient"|"balanced"|"max_quality",
--                    "dimensions": 1536 } }              -- embeddings only
--    Mirrors DEFAULT_AI_ROUTING in packages/db/src/routing.ts (keep both in sync).
-- 2. kortex.ai_model_catalog: cached model discovery per provider (read: authenticated,
--    write: service role only).
-- 3. preferred_chat_model / preferred_fast_model / embedding_model are deprecated (kept);
--    values a user changed from the old defaults are carried over into the routing.

-- 1. Routing column -----------------------------------------------------------------------

alter table kortex.user_settings
  add column if not exists ai_routing_config jsonb not null default '{
    "summarize":           {"provider": "anthropic",  "model_id": null, "auto_mode": "cost_efficient"},
    "auto_organize":       {"provider": "anthropic",  "model_id": null, "auto_mode": "cost_efficient"},
    "chat_reasoning":      {"provider": "anthropic",  "model_id": null, "auto_mode": "max_quality"},
    "meeting_coach":       {"provider": "anthropic",  "model_id": null, "auto_mode": "balanced"},
    "vision_ocr":          {"provider": "openrouter", "model_id": null, "auto_mode": "balanced"},
    "audio_transcription": {"provider": "edenai",     "model_id": null, "auto_mode": "balanced"},
    "document_parsing":    {"provider": "edenai",     "model_id": null, "auto_mode": "balanced"},
    "embeddings":          {"provider": "openrouter", "model_id": null, "auto_mode": "cost_efficient", "dimensions": 1536}
  }'::jsonb;

-- Shape guard (the app validates the details with Zod): an object, and the embedding route can
-- never ask for another vector size than kortex.item_chunks.embedding (vector(1536)).
alter table kortex.user_settings
  drop constraint if exists user_settings_ai_routing_config_check;
alter table kortex.user_settings
  add constraint user_settings_ai_routing_config_check check (
    jsonb_typeof(ai_routing_config) = 'object'
    and (
      ai_routing_config -> 'embeddings' is null
      or coalesce(ai_routing_config -> 'embeddings' ->> 'dimensions', '1536') = '1536'
    )
  );

comment on column kortex.user_settings.ai_routing_config is
  'ADR-06 task routing: { task: { provider, model_id (null = Auto), auto_mode, dimensions (embeddings: always 1536) } }. Defaults: packages/db/src/routing.ts DEFAULT_AI_ROUTING.';
comment on column kortex.user_settings.preferred_chat_model is
  'DEPRECATED (ADR-06): use ai_routing_config.chat_reasoning. Kept for old clients.';
comment on column kortex.user_settings.preferred_fast_model is
  'DEPRECATED (ADR-06): use ai_routing_config.summarize / auto_organize. Kept for old clients.';
comment on column kortex.user_settings.embedding_model is
  'DEPRECATED (ADR-06): use ai_routing_config.embeddings. Kept for old clients.';

-- 3. Backfill: only values a user changed from the old column defaults. Those were OpenRouter
-- model ids, so they become exact OpenRouter routes.
update kortex.user_settings s
set ai_routing_config = s.ai_routing_config
  || case
       when s.preferred_chat_model is not null and s.preferred_chat_model <> 'anthropic/claude-3.7-sonnet'
       then jsonb_build_object('chat_reasoning', jsonb_build_object(
              'provider', 'openrouter', 'model_id', s.preferred_chat_model, 'auto_mode', 'max_quality'))
       else '{}'::jsonb
     end
  || case
       when s.preferred_fast_model is not null and s.preferred_fast_model <> 'google/gemini-2.5-flash'
       then jsonb_build_object(
              'summarize', jsonb_build_object('provider', 'openrouter', 'model_id', s.preferred_fast_model, 'auto_mode', 'cost_efficient'),
              'auto_organize', jsonb_build_object('provider', 'openrouter', 'model_id', s.preferred_fast_model, 'auto_mode', 'cost_efficient'))
       else '{}'::jsonb
     end
  || case
       when s.embedding_model is not null and s.embedding_model <> 'openai/text-embedding-3-small'
       then jsonb_build_object('embeddings', jsonb_build_object(
              'provider', 'openrouter', 'model_id', s.embedding_model, 'auto_mode', 'cost_efficient', 'dimensions', 1536))
       else '{}'::jsonb
     end
where s.preferred_chat_model <> 'anthropic/claude-3.7-sonnet'
   or s.preferred_fast_model <> 'google/gemini-2.5-flash'
   or s.embedding_model <> 'openai/text-embedding-3-small';

-- 2. Model catalog cache ------------------------------------------------------------------------

create table if not exists kortex.ai_model_catalog (
  provider text not null check (provider in ('anthropic', 'openrouter', 'edenai')),
  model_id text not null,
  display_name text,
  -- what the model can do: chat, vision, ocr, audio_transcription, document_parsing, embeddings
  capabilities text[] not null default '{}',
  context_length int,
  -- output size of embedding models; routing only accepts 1536 for the embeddings task
  embedding_dimensions int,
  -- normalised prices in USD: { "input_per_mtok": n, "output_per_mtok": n, "per_unit": n, "unit": "..." }
  pricing jsonb not null default '{}'::jsonb,
  -- provider payload as fetched (for fields the app does not normalise yet)
  raw jsonb not null default '{}'::jsonb,
  is_available boolean not null default true,
  fetched_at timestamptz not null default now(),
  primary key (provider, model_id)
);

create index if not exists idx_ai_model_catalog_capabilities
  on kortex.ai_model_catalog using gin (capabilities);

comment on table kortex.ai_model_catalog is
  'ADR-06 model discovery cache (shared, not per user). Written by the service role (ai-core discovery), read by signed-in users.';

alter table kortex.ai_model_catalog enable row level security;

-- Default privileges of schema kortex grant write access to authenticated; the catalog is
-- read-only for users.
revoke insert, update, delete, truncate on kortex.ai_model_catalog from authenticated;
grant select on kortex.ai_model_catalog to authenticated;
grant all on kortex.ai_model_catalog to service_role;

drop policy if exists "Signed-in users read the model catalog" on kortex.ai_model_catalog;
create policy "Signed-in users read the model catalog" on kortex.ai_model_catalog
  for select to authenticated using (true);

-- PostgREST picks up the new column/table.
notify pgrst, 'reload schema';
