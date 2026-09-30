-- ============================================================
-- AquaGuard — Admin panel data access
-- Run once in the Supabase SQL Editor, BEFORE synthetic_data.sql
-- (the device RLS policies at the bottom of this file reference
-- the is_admin() helper defined here).
-- ============================================================

-- ---------- Helper: is the current signed-in user an Admin? ----------
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

-- ---------- Accounts list for the admin console ----------
-- Returns every registered account with the devices already assigned
-- to it, so the admin can see who exists and what they own.
create or replace function public.admin_list_accounts()
returns table (
  user_id        uuid,
  email          text,
  name           text,
  phone          text,
  role           text,
  device_count   bigint,
  assigned_codes text
)
language sql
security definer
set search_path = public, auth
as $$
  select
    p.id,
    u.email,
    p.name,
    p.phone,
    p.role,
    count(d.id)                                as device_count,
    coalesce(string_agg(d.pairing_code, ', ' order by d.pairing_code), '') as assigned_codes
  from public.profiles p
  join auth.users u        on u.id = p.id
  left join public.devices d on d.owner_id = p.id
  group by p.id, u.email, p.name, p.phone, p.role
  order by p.role, u.email;
$$;

revoke all on function public.admin_list_accounts() from public;
grant execute on function public.admin_list_accounts() to authenticated;

-- ---------- Device / code list for the admin console ----------
-- One row per device: its code, pipe, sensor, online status, whether
-- it has been claimed, and by whom. Codes that are still unclaimed
-- are exactly the ones the admin can hand to an account.
create or replace function public.admin_list_devices()
returns table (
  device_id    uuid,
  pipe_number  text,
  sensor_id    text,
  pairing_code text,
  type         text,
  status       text,
  claimed      boolean,
  owner_email  text
)
language sql
security definer
set search_path = public, auth
as $$
  select
    d.id,
    d.pipe_number,
    d.sensor_id,
    d.pairing_code,
    d.type,
    d.status,
    d.owner_id is not null        as claimed,
    u.email                       as owner_email
  from public.devices d
  left join auth.users u on u.id = d.owner_id
  order by (d.owner_id is null) desc, d.pairing_code;
$$;

revoke all on function public.admin_list_devices() from public;
grant execute on function public.admin_list_devices() to authenticated;

-- ============================================================
-- RLS policies: only Admins may read the full device list.
-- (Regular users keep the policies from schema.sql / the pairing
-- migration: they can only see devices they own, plus claim a
-- device by pairing code.)
-- ============================================================
drop policy if exists "Admins can view all devices" on public.devices;
create policy "Admins can view all devices"
  on public.devices
  for select
  to authenticated
  using (public.is_admin());

-- Admins may also edit device rows directly (fix a status, unassign,
-- regenerate a code) without going through the RPC.
drop policy if exists "Admins can update devices" on public.devices;
create policy "Admins can update devices"
  on public.devices
  for update
  to authenticated
  using (public.is_admin());
