-- ============================================================
-- AquaGuard — Admin panel data access
-- Run in the Supabase SQL Editor AFTER admin_assign_device.sql (needs
-- devices.assigned_to) and BEFORE synthetic_data.sql / make_admin.sql
-- (both rely on the is_admin() helper defined here). Safe to re-run.
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
grant execute on function public.is_admin() to authenticated;

-- ---------- Accounts list for the admin console ----------
-- Every Home Owner / WSP account (Admins excluded), with sign-in
-- activity, codes reserved for them and devices they have paired.
-- Requires the devices.assigned_to column from admin_assign_device.sql.
drop function if exists public.admin_list_accounts();
create function public.admin_list_accounts()
returns table (
  user_id         uuid,
  email           text,
  name            text,
  phone           text,
  role            text,
  signed_up_at    timestamptz,
  last_sign_in_at timestamptz,
  device_count    bigint,
  pending_codes   text,
  paired_codes    text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can list accounts';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.name::text,
    p.phone::text,
    p.role::text,
    u.created_at,
    u.last_sign_in_at,
    count(d.id) filter (where d.owner_id = p.id),
    coalesce(string_agg(d.pairing_code::text, ', ' order by d.pairing_code) filter (where d.owner_id is null), ''),
    coalesce(string_agg(d.pairing_code::text, ', ' order by d.pairing_code) filter (where d.owner_id = p.id), '')
  from public.profiles p
  join auth.users u          on u.id = p.id
  left join public.devices d on d.owner_id = p.id or d.assigned_to = p.id
  where p.role in ('HomeOwner', 'WSP')
  group by p.id, u.email, p.name, p.phone, p.role, u.created_at, u.last_sign_in_at
  order by u.last_sign_in_at desc nulls last, u.email;
end;
$$;

revoke all on function public.admin_list_accounts() from public;
grant execute on function public.admin_list_accounts() to authenticated;

-- ---------- Device / code list for the admin console ----------
-- One row per device: its code, pipe, sensor, status, which account
-- the code is reserved for, and who (if anyone) has claimed it.
drop function if exists public.admin_list_devices();
create function public.admin_list_devices()
returns table (
  device_id      uuid,
  pipe_number    text,
  sensor_id      text,
  pairing_code   text,
  type           text,
  status         text,
  claimed        boolean,
  owner_email    text,
  assigned_email text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can list devices';
  end if;

  return query
  select
    d.id,
    d.pipe_number::text,
    d.sensor_id::text,
    d.pairing_code::text,
    d.type::text,
    d.status::text,
    d.owner_id is not null,
    owner_u.email::text,
    assigned_u.email::text
  from public.devices d
  left join auth.users owner_u    on owner_u.id = d.owner_id
  left join auth.users assigned_u on assigned_u.id = d.assigned_to
  order by (d.owner_id is null) desc, d.pairing_code;
end;
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
