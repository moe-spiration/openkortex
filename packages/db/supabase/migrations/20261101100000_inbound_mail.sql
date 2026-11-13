-- Mail an Kortex (S4): every user gets a private inbound address <token>@<KORTEX_INBOUND_MAIL_DOMAIN>.
-- Additive only, schema kortex only.
--
--   inbound_mail_token:      random local part of the address (lowercase base32, 20-64 chars, about
--                            100 bits). Not guessable, rotatable, null = no address (mail is off).
--                            Written by the web app server (Settings → "Mail an Kortex"), never
--                            derived from the user id. Unique: one token maps to exactly one user.
--   inbound_mail_rotated_at: when the current token was created (shown in Settings).
--
-- The webhook (/api/ingest/mail) looks the token up with the service role; the unique constraint
-- gives it the index it needs.

alter table kortex.user_settings
  add column if not exists inbound_mail_token text;

alter table kortex.user_settings
  add column if not exists inbound_mail_rotated_at timestamptz;

alter table kortex.user_settings
  drop constraint if exists user_settings_inbound_mail_token_check;
alter table kortex.user_settings
  add constraint user_settings_inbound_mail_token_check
  check (inbound_mail_token is null or inbound_mail_token ~ '^[a-z2-7]{20,64}$');

alter table kortex.user_settings
  drop constraint if exists user_settings_inbound_mail_token_key;
alter table kortex.user_settings
  add constraint user_settings_inbound_mail_token_key unique (inbound_mail_token);

comment on column kortex.user_settings.inbound_mail_token is
  'Local part of the private inbound mail address (<token>@KORTEX_INBOUND_MAIL_DOMAIN). Random, rotatable; null = off.';
comment on column kortex.user_settings.inbound_mail_rotated_at is
  'When inbound_mail_token was created or last rotated.';

notify pgrst, 'reload schema';
