-- ============================================================
-- AquaGuard — Promote the project admin + block self-promotion
-- Run once in the Supabase SQL Editor, AFTER admin_panel_functions.sql
-- (the guard below uses its is_admin() helper).
-- The account must already exist (sign up first, then run this).
-- ============================================================

-- ---------- 1. Guard: only an Admin can grant the Admin role ----------
-- Sign-up writes the profile row from the browser, so without this a
-- user could send role = 'Admin' for themselves. SQL Editor / service
-- role calls have no auth.uid(), so promotions done here still work.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.role = 'Admin' and (tg_op = 'INSERT' or old.role is distinct from 'Admin') then
    raise exception 'Only an administrator can grant the Admin role';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role
  before insert or update of role on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------- 2. Promote the project admin ----------
insert into public.profiles (id, name, role)
select u.id,
       coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
       'Admin'
  from auth.users u
 where lower(u.email) = lower('justus.kamande@strathmore.edu')
on conflict (id) do update set role = 'Admin';

-- ---------- 3. Check ----------
select u.email, p.role
  from public.profiles p
  join auth.users u on u.id = p.id
 where p.role = 'Admin';
