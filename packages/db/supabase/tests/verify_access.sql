-- Allowlist RPCs (20261030010000): runs inside db:verify's rolled-back transaction, after
-- verify_rls.sql. Throwaway auth users with fixed ids; nothing survives the rollback.
insert into auth.users (id, email, email_confirmed_at, aud, role) values
 ('a1111111-1111-4111-8111-111111111111', 'verify-owner@kortex.test', now(), 'authenticated', 'authenticated'),
 ('a2222222-2222-4222-8222-222222222222', 'verify-admin@kortex.test', now(), 'authenticated', 'authenticated'),
 ('a3333333-3333-4333-8333-333333333333', 'verify-late@kortex.test', now(), 'authenticated', 'authenticated');
insert into kortex.allowed_users (user_id, email, role) values
 ('a1111111-1111-4111-8111-111111111111', 'verify-owner@kortex.test', 'owner'),
 ('a2222222-2222-4222-8222-222222222222', 'verify-admin@kortex.test', 'admin');

create or replace function pg_temp.expect_denied(sql text, what text) returns void
language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL access: % was allowed', what;
exception when insufficient_privilege then
  raise notice 'PASS access: % denied', what;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
do $$ begin
  if kortex.access_invite('Verify-New@Kortex.test', 'member') <> 'invited' then raise exception 'FAIL access: pending invite'; end if;
  if kortex.access_invite('verify-late@kortex.test', 'admin') <> 'member' then raise exception 'FAIL access: invite of an existing account'; end if;
  if (select count(*) from kortex.access_list() where email like 'verify-%@kortex.test') <> 4 then raise exception 'FAIL access: list'; end if;
  raise notice 'PASS access: owner invites, list';
end $$;
select pg_temp.expect_denied($$select kortex.access_remove('verify-owner@kortex.test')$$, 'removing yourself');
select pg_temp.expect_denied($$select 1 from kortex.allowlist_invites$$, 'reading invites directly');

select set_config('request.jwt.claims', '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select pg_temp.expect_denied($$select kortex.access_invite('x@kortex.test', 'owner')$$, 'admin granting owner');
select pg_temp.expect_denied($$select kortex.access_remove('verify-owner@kortex.test')$$, 'admin removing an owner');
do $$ begin
  if not kortex.access_remove('verify-late@kortex.test') then raise exception 'FAIL access: admin removes admin'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
do $$ begin
  if kortex.is_allowed() then raise exception 'FAIL access: removed account still allowed'; end if;
end $$;
select pg_temp.expect_denied($$select * from kortex.access_list()$$, 'outsider listing');
reset role;

insert into auth.users (id, email, email_confirmed_at, aud, role) values
 ('a4444444-4444-4444-8444-444444444444', 'verify-new@kortex.test', now(), 'authenticated', 'authenticated');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
do $$ begin
  if not kortex.is_allowed() then raise exception 'FAIL access: invited account not allowed'; end if;
  perform kortex.bootstrap_user();
end $$;
reset role;
do $$ begin
  if not exists (select 1 from kortex.allowed_users where user_id = 'a4444444-4444-4444-8444-444444444444' and role = 'member')
     or exists (select 1 from kortex.allowlist_invites where email = 'verify-new@kortex.test')
  then raise exception 'FAIL access: invite not claimed on bootstrap'; end if;
  raise notice 'PASS access: invite claimed on signup';
end $$;
