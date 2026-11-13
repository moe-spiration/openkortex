-- Bilingual interface (English source, German second language): English is now the default
-- language of a NEW account. Additive only.
--
-- kortex.user_settings.locale was added in 20261027000000 with default 'de'. Only the column
-- default changes here: existing rows keep their value (every account created so far stays
-- German until its user picks another language in the settings), and the check constraint
-- (locale in ('de', 'en')) stays as it is.
--
-- The account bootstrap inserts the settings row with the user id only, so new accounts take
-- this column default; no function has to change. A client that knows the user's device or
-- browser language writes it right after sign-up (settings "Language").

alter table kortex.user_settings alter column locale set default 'en';

comment on column kortex.user_settings.locale is
  'UI and AI answer language (en, de). Default en for new accounts; rows created before 2026-11-11 kept de.';
