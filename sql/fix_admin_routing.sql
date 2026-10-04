-- ============================================================
-- AquaGuard — Fix admin routing (admin lands on dashboard.html)
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- WHY THIS WAS HAPPENING
-- auth.js / dashboard.js / admin.js read the role from
-- public.profiles through RLS. If profiles has no SELECT policy,
-- or the admin's row is missing, or the role is stored as
-- 'admin' (lowercase), the read comes back EMPTY WITH NO ERROR,
-- every role check silently fails, and the code falls through to
-- dashboard.html on all three pages.
-- This script fixes the data and adds the missing policies.
-- (The JS files were also hardened: case-insensitive checks plus
-- an is_admin() RPC fallback that bypasses RLS.)
-- ============================================================

-- ---------- 1. profiles table (only created if it does not exist) ----------
create table if not exists public.profiles (
  id    uuid primary key references auth.users (id) on delete cascade,
  name  text,
  phone text,
  role  text not null default 'HomeOwner'
);

alter table public.profiles enable row level security;

-- ---------- 2. is_admin() helper ----------
-- Same definition as admin_panel_functions.sql; re-asserting it here
-- makes this script self-contained (the RLS policies below use it).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles
     where id = auth.uid()
       and role = 'Admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------- 3. Canonicalise role values ----------
-- Repairs any case/spacing mismatches ('admin', ' Admin ', 'homeowner'...)
-- against the exact values the app expects: Admin / HomeOwner / WSP.
update public.profiles set role = 'Admin'     where lower(trim(role)) = 'admin';
update public.profiles set role = 'HomeOwner' where lower(trim(role)) in ('homeowner', 'home_owner', 'home owner');
update public.profiles set role = 'WSP'       where lower(trim(role)) = 'wsp';

-- ---------- 4. Make sure the admin's profile row exists with role = 'Admin' ----------
-- Works whether the row is missing (insert) or present with the wrong
-- role (update). Runs as SQL Editor / service context, so the
-- guard_profile_role trigger from make_admin.sql allows it.
insert into public.profiles (id, name, role)
select u.id,
       coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
       'Admin'
  from auth.users u
 where lower(u.email) = lower('justus.kamande@strathmore.edu')
on conflict (id) do update set role = 'Admin';

-- ---------- 5. RLS policies so role reads actually work ----------
-- Without a SELECT policy, profiles reads return empty for everyone —
-- that is the silent failure that sent the admin to dashboard.html.

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());

-- The sign-up page writes its own profile row from the browser.
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Users may edit their own name/phone. Role changes stay blocked by
-- the guard_profile_role trigger from make_admin.sql.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Re-assert table grants in case they were revoked at some point
-- (Supabase grants these by default).
grant select, insert, update on public.profiles to authenticated;

-- ---------- 6. Verify ----------
-- Expected: exactly one row for your email with role = 'Admin'.
select u.email, p.id, p.role
  from public.profiles p
  join auth.users u on u.id = p.id
 where lower(u.email) = lower('justus.kamande@strathmore.edu');
