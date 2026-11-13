-- Media pipeline: per-item cap for paid speech-to-text of long media (podcasts, audio).
-- Additive only. 0 = never transcribe automatically. The daily AI budget (S2a) applies on top.

alter table kortex.user_settings
  add column if not exists media_max_minutes int not null default 90;

alter table kortex.user_settings
  drop constraint if exists user_settings_media_max_minutes_check;
alter table kortex.user_settings
  add constraint user_settings_media_max_minutes_check check (media_max_minutes between 0 and 600);

comment on column kortex.user_settings.media_max_minutes is
  'Longest episode/audio (minutes) Kortex transcribes automatically per item; 0 = never. Longer ones are saved without a transcript and a clear note.';
