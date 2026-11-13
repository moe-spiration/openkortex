-- Theme packs: the chosen cover/background pack and the accent colour follow the user across devices.
-- Both were device-local (browser storage) until now. Additive; defaults match the app defaults.
--   theme_pack: pack id from @kortex/theme-packs (foto, origami, fluid, nature, air, energy, calm). The id list
--               lives in code (a later pack needs no migration); the app falls back to calm for unknown ids.
--   accent:     preset id (indigo, teal, violet, blue, rose, amber) or a custom #rrggbb.

alter table kortex.user_settings
  add column if not exists theme_pack text not null default 'calm';

alter table kortex.user_settings
  add column if not exists accent text not null default 'indigo';

alter table kortex.user_settings
  drop constraint if exists user_settings_theme_pack_check;
alter table kortex.user_settings
  add constraint user_settings_theme_pack_check check (theme_pack ~ '^[a-z][a-z0-9_-]{1,31}$');

alter table kortex.user_settings
  drop constraint if exists user_settings_accent_check;
alter table kortex.user_settings
  add constraint user_settings_accent_check check (accent ~ '^([a-z]{3,16}|#[0-9a-fA-F]{6})$');

comment on column kortex.user_settings.theme_pack is
  'Theme pack for covers and backgrounds (id from @kortex/theme-packs). Default calm.';
comment on column kortex.user_settings.accent is
  'Accent colour: preset id or #rrggbb. Default indigo.';

notify pgrst, 'reload schema';
