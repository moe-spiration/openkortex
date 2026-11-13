-- Allowlist management from Settings (owner/admin), replacing the CLI-only path (db:allow stays).
-- Additive, schema kortex only.
--
-- 1. kortex.allowlist_invites: an invite for an email that has no account yet. When that person
--    signs up and confirms the address, kortex.is_allowed() is true for them and bootstrap_user()
--    turns the invite into an allowed_users row. No direct table access; RPCs only.
-- 2. RPCs for owners/admins (security definer, caller role checked inside):
--      kortex.access_list()                    members + pending invites
--      kortex.access_invite(email, role)       member if the account exists, else pending invite
--      kortex.access_remove(email)             removes member and/or invite
--    Rules: only an owner grants or removes 'owner'; nobody removes themselves; the last owner
--    stays. Admins manage admins and members.

create table if not exists kortex.allowlist_invites (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now()
);

comment on table kortex.allowlist_invites is
  'Pending Kortex invites for emails without an account. Claimed by bootstrap_user() after signup (confirmed email). RPC access only.';

alter table kortex.allowlist_invites enable row level security;
revoke all on kortex.allowlist_invites from authenticated, anon;
grant all on kortex.allowlist_invites to service_role;
-- No authenticated policies (RPC access only); the gate keeps the S2a invariant for every table.
drop policy if exists "kortex: allowlisted users only" on kortex.allowlist_invites;
create policy "kortex: allowlisted users only" on kortex.allowlist_invites as restrictive for all to authenticated
  using ((select kortex.is_allowed())) with check ((select kortex.is_allowed()));

-- Confirmed email of the calling user (null when unconfirmed).
create or replace function kortex._caller_confirmed_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;
revoke all on function kortex._caller_confirmed_email() from public, anon, authenticated;

create or replace function kortex.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from kortex.allowed_users a where a.user_id = auth.uid())
      or exists (
        select 1 from kortex.allowlist_invites i
        where i.email = kortex._caller_confirmed_email()
      );
$$;
revoke all on function kortex.is_allowed() from public, anon;
grant execute on function kortex.is_allowed() to authenticated, service_role;

create or replace function kortex.bootstrap_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'kortex.bootstrap_user: not authenticated';
  end if;
  if not exists (select 1 from kortex.allowed_users a where a.user_id = v_uid) then
    v_email := kortex._caller_confirmed_email();
    insert into kortex.allowed_users (user_id, email, role, invited_by, invited_at, note)
    select v_uid, v_email, i.role, i.invited_by, i.invited_at, 'invite claimed'
    from kortex.allowlist_invites i
    where v_email is not null and i.email = v_email
    on conflict (user_id) do nothing;
    delete from kortex.allowlist_invites i where v_email is not null and i.email = v_email;
  end if;
  if not exists (select 1 from kortex.allowed_users a where a.user_id = v_uid) then
    raise exception 'kortex: kein Zugang (account not on the Kortex allowlist)'
      using errcode = '42501';
  end if;
  perform kortex._bootstrap_user(v_uid);
end;
$$;
revoke all on function kortex.bootstrap_user() from public, anon;
grant execute on function kortex.bootstrap_user() to authenticated;

-- Role of the caller, or null.
create or replace function kortex._caller_access_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.role from kortex.allowed_users a where a.user_id = auth.uid();
$$;
revoke all on function kortex._caller_access_role() from public, anon, authenticated;

create or replace function kortex.access_list()
returns table (
  email text,
  user_id uuid,
  role text,
  status text,
  invited_at timestamptz,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(kortex._caller_access_role(), '') not in ('owner', 'admin') then
    raise exception 'kortex: nur Owner und Admins verwalten den Zugang' using errcode = '42501';
  end if;
  return query
    select coalesce(lower(u.email), a.email), a.user_id, a.role, 'member'::text, a.invited_at,
           a.user_id = auth.uid()
    from kortex.allowed_users a
    left join auth.users u on u.id = a.user_id
    union all
    select i.email, null::uuid, i.role, 'invited'::text, i.invited_at, false
    from kortex.allowlist_invites i
    order by 4, 1;
end;
$$;
revoke all on function kortex.access_list() from public, anon;
grant execute on function kortex.access_list() to authenticated;

create or replace function kortex.access_invite(p_email text, p_role text default 'member')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller text := kortex._caller_access_role();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid uuid;
  v_current text;
begin
  if coalesce(v_caller, '') not in ('owner', 'admin') then
    raise exception 'kortex: nur Owner und Admins verwalten den Zugang' using errcode = '42501';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 320 then
    raise exception 'kortex: ungültige E-Mail-Adresse' using errcode = '22023';
  end if;
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'kortex: ungültige Rolle' using errcode = '22023';
  end if;
  if p_role = 'owner' and v_caller <> 'owner' then
    raise exception 'kortex: nur ein Owner vergibt die Rolle Owner' using errcode = '42501';
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = v_email limit 1;
  if v_uid is not null then
    if v_uid = auth.uid() then
      raise exception 'kortex: die eigene Rolle lässt sich hier nicht ändern' using errcode = '42501';
    end if;
    select a.role into v_current from kortex.allowed_users a where a.user_id = v_uid;
    if v_current = 'owner' and v_caller <> 'owner' then
      raise exception 'kortex: nur ein Owner ändert einen Owner' using errcode = '42501';
    end if;
    insert into kortex.allowed_users (user_id, email, role, invited_by, note)
    values (v_uid, v_email, p_role, auth.uid(), 'invited in settings')
    on conflict (user_id) do update set role = excluded.role, email = excluded.email;
    delete from kortex.allowlist_invites i where i.email = v_email;
    return 'member';
  end if;

  select i.role into v_current from kortex.allowlist_invites i where i.email = v_email;
  if v_current = 'owner' and v_caller <> 'owner' then
    raise exception 'kortex: nur ein Owner ändert einen Owner' using errcode = '42501';
  end if;
  insert into kortex.allowlist_invites (email, role, invited_by)
  values (v_email, p_role, auth.uid())
  on conflict (email) do update set role = excluded.role, invited_by = excluded.invited_by,
    invited_at = now();
  return 'invited';
end;
$$;
revoke all on function kortex.access_invite(text, text) from public, anon;
grant execute on function kortex.access_invite(text, text) to authenticated;

create or replace function kortex.access_remove(p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller text := kortex._caller_access_role();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid uuid;
  v_role text;
  v_found boolean := false;
begin
  if coalesce(v_caller, '') not in ('owner', 'admin') then
    raise exception 'kortex: nur Owner und Admins verwalten den Zugang' using errcode = '42501';
  end if;

  select a.user_id, a.role into v_uid, v_role
  from kortex.allowed_users a
  left join auth.users u on u.id = a.user_id
  where lower(coalesce(u.email, a.email)) = v_email
  limit 1;
  if v_uid is not null then
    if v_uid = auth.uid() then
      raise exception 'kortex: den eigenen Zugang kannst Du nicht entfernen' using errcode = '42501';
    end if;
    if v_role = 'owner' and v_caller <> 'owner' then
      raise exception 'kortex: nur ein Owner entfernt einen Owner' using errcode = '42501';
    end if;
    if v_role = 'owner' and (select count(*) from kortex.allowed_users where role = 'owner') <= 1 then
      raise exception 'kortex: der letzte Owner bleibt' using errcode = '42501';
    end if;
    delete from kortex.allowed_users a where a.user_id = v_uid;
    v_found := true;
  end if;

  select i.role into v_role from kortex.allowlist_invites i where i.email = v_email;
  if found then
    if v_role = 'owner' and v_caller <> 'owner' then
      raise exception 'kortex: nur ein Owner entfernt einen Owner' using errcode = '42501';
    end if;
    delete from kortex.allowlist_invites i where i.email = v_email;
    v_found := true;
  end if;
  return v_found;
end;
$$;
revoke all on function kortex.access_remove(text) from public, anon;
grant execute on function kortex.access_remove(text) to authenticated;

notify pgrst, 'reload schema';
