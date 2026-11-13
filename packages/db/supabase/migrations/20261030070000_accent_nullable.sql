-- Accent colour: NULL = "never chosen". The first version of the column (20261030060000) was NOT NULL DEFAULT 'indigo',
-- which made every existing row look like an explicit choice of indigo. A device with another accent could then not tell
-- "the user picked indigo" from "nothing stored yet". With NULL the first device that loads the row uploads its own accent;
-- afterwards the stored value wins on every device. Rows that still hold the untouched default are reset to NULL.

alter table kortex.user_settings alter column accent drop not null;
alter table kortex.user_settings alter column accent drop default;

update kortex.user_settings set accent = null where accent = 'indigo';

comment on column kortex.user_settings.accent is
  'Accent colour: preset id or #rrggbb. NULL = never chosen (the first device uploads its own).';

notify pgrst, 'reload schema';
