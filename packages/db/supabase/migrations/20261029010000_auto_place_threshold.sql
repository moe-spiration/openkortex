-- Zero-setup auto-placement (CLAUDE.md principle "Fire & Forget"). Additive, schema kortex only.
--
-- The organizer reports how sure it is about folder + tags + type
-- (knowledge_items.metadata.placement.confidence, 0..1). Placements at or above the user's
-- threshold are applied silently; only items below it (or flagged with
-- metadata.placement.review = true via "Prüfen") wait in the Inbox for "Übernehmen".

alter table kortex.user_settings
  add column if not exists auto_place_threshold numeric(3, 2) not null default 0.7;

alter table kortex.user_settings
  drop constraint if exists user_settings_auto_place_threshold_check;
alter table kortex.user_settings
  add constraint user_settings_auto_place_threshold_check check (auto_place_threshold between 0 and 1);

comment on column kortex.user_settings.auto_place_threshold is
  'Organizer placement confidence (0..1) from which captures are filed without review. 1 = always review.';

notify pgrst, 'reload schema';
