-- Zero setup: every implemented ingest connector is on by default. Additive only, schema kortex only.
--
-- The initial default left out 'podcast' (Spotify/Apple), 'social' (Instagram Reels, TikTok) and
-- 'vision' (screenshots, images), so those captures were refused with 422 connector_disabled
-- until the user found the toggle. All three adapters work server-side now.
--
-- Backfill: the three were never on by default, so a row without them never had them on;
-- they are added to every row that lacks them, and nothing else in the array changes (a
-- connector the user switched off stays off). null (= all allowed) stays null.

alter table kortex.user_settings
  alter column enabled_connectors
  set default array['web', 'youtube', 'podcast', 'social', 'pdf', 'epub', 'recipe', 'meeting', 'ai_chat', 'vision']::text[];

update kortex.user_settings
set enabled_connectors = enabled_connectors || array(
  select c
  from unnest(array['podcast', 'social', 'vision']::text[]) with ordinality as n (c, i)
  where not (c = any (enabled_connectors))
  order by i
)
where enabled_connectors is not null
  and not (enabled_connectors @> array['podcast', 'social', 'vision']::text[]);
